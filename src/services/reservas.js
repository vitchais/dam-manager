// ============================================================================
// src/services/reservas.js
//
// Regras de negócio das reservas. Tudo que grava reserva passa por aqui —
// o chatbot e o painel administrativo compartilham estas funções, para que as
// validações não fiquem duplicadas (e divergentes) em dois lugares.
// ============================================================================

import { getSupabase } from '../lib/supabase.js';
import { env } from '../config/env.js';
import {
  hojeISO,
  agoraHHMM,
  dataValida,
  normalizarHorario,
  diferencaEmDias,
  formatarBR,
} from '../lib/datas.js';

/** Erro de regra de negócio — a mensagem pode ser mostrada ao cliente. */
export class ErroDeReserva extends Error {}

const SELECT_COM_CLIENTE = `
    *,
    clientes!reservas_cliente_id_fkey(
        nome,
        telefone
    )
`;

/** Acha o cliente pelo telefone ou cria um novo. */
export async function acharOuCriarCliente({ telefone, nome = null }) {
  const supabase = getSupabase();
  const numero = String(telefone).replace(/\D/g, '');

  if (!numero) throw new ErroDeReserva('Telefone inválido.');

  const { data: existente, error: erroBusca } = await supabase
    .from('clientes')
    .select('*')
    .eq('telefone', numero)
    .maybeSingle();

  if (erroBusca) throw new Error(`Erro ao buscar cliente: ${erroBusca.message}`);

  if (existente) {
    // Só preenche o nome se ainda não tivermos um: o nome informado numa
    // conversa antiga não deve ser sobrescrito por um apelido digitado depois.
    if (nome && !existente.nome) {
      const { data: atualizado, error } = await supabase
        .from('clientes')
        .update({ nome })
        .eq('id', existente.id)
        .select()
        .single();
      if (error) throw new Error(`Erro ao atualizar cliente: ${error.message}`);
      return atualizado;
    }
    return existente;
  }

  const { data: criado, error } = await supabase
    .from('clientes')
    .insert({ telefone: numero, nome })
    .select()
    .single();

  if (error) throw new Error(`Erro ao criar cliente: ${error.message}`);
  return criado;
}

/**
 * Valida data/horário/pessoas contra as regras da casa.
 * Devolve os valores já normalizados.
 */
export function validarPedido({ data, horario, pessoas }) {
  if (!dataValida(data)) {
    throw new ErroDeReserva(
      'Data inválida. Preciso da data no formato AAAA-MM-DD.',
    );
  }

  const horarioNormalizado = normalizarHorario(horario);
  if (!horarioNormalizado) {
    throw new ErroDeReserva('Horário inválido. Use algo como 20:00.');
  }

  const quantidade = Number(pessoas);
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new ErroDeReserva('Informe quantas pessoas vão (número inteiro).');
  }
  if (quantidade > env.casa.capacidadeMaxima) {
    throw new ErroDeReserva(
      `Para grupos acima de ${env.casa.capacidadeMaxima} pessoas o atendimento é feito por um de nossos gerentes.`,
    );
  }

  const hoje = hojeISO();
  const distancia = diferencaEmDias(hoje, data);

  if (distancia < 0) {
    throw new ErroDeReserva('Essa data já passou.');
  }
  if (distancia > env.reserva.janelaDias) {
    throw new ErroDeReserva(
      `Só conseguimos reservar com até ${env.reserva.janelaDias} dias de antecedência.`,
    );
  }

  // Antecedência mínima só importa para reservas do próprio dia.
  if (distancia === 0) {
    const [horaAlvo, minutoAlvo] = horarioNormalizado.split(':').map(Number);
    const [horaAgora, minutoAgora] = agoraHHMM().split(':').map(Number);
    const minutosAlvo = horaAlvo * 60 + minutoAlvo;
    const minutosAgora = horaAgora * 60 + minutoAgora;
    const minimo = env.reserva.antecedenciaHoras * 60;

    if (minutosAlvo - minutosAgora < minimo) {
      throw new ErroDeReserva(
        `Para hoje, preciso de pelo menos ${env.reserva.antecedenciaHoras}h de antecedência. Quer tentar um horário mais tarde ou outro dia?`,
      );
    }
  }

  return { data, horario: horarioNormalizado, pessoas: quantidade };
}

/** Soma quantas pessoas já estão reservadas em uma data. */
export async function ocupacaoDaData(data) {
  const supabase = getSupabase();

  const { data: linhas, error } = await supabase
    .from('reservas')
    .select('pessoas')
    .eq('data_reserva', data)
    .in('status', ['Pendente', 'Confirmada']);

  if (error) throw new Error(`Erro ao consultar ocupação: ${error.message}`);

  return (linhas ?? []).reduce((total, linha) => total + (linha.pessoas ?? 0), 0);
}

/** Diz se ainda cabe um grupo de N pessoas na data. */
export async function verificarDisponibilidade({ data, horario, pessoas }) {
  const pedido = validarPedido({ data, horario, pessoas });
  const ocupadas = await ocupacaoDaData(pedido.data);
  const livres = env.casa.capacidadeMaxima - ocupadas;

  return {
    disponivel: livres >= pedido.pessoas,
    lugaresLivres: Math.max(livres, 0),
    ...pedido,
  };
}

/** Cria a reserva. Devolve a linha criada já com os dados do cliente. */
export async function criarReserva({
  telefone,
  nome,
  data,
  horario,
  pessoas,
  ambiente = null,
  observacoes = null,
  origem = 'whatsapp',
}) {
  const pedido = validarPedido({ data, horario, pessoas });

  const disponibilidade = await verificarDisponibilidade(pedido);
  if (!disponibilidade.disponivel) {
    throw new ErroDeReserva(
      `Infelizmente não temos mais lugar para ${pedido.pessoas} pessoas no dia ${formatarBR(pedido.data)}. Quer tentar outro dia?`,
    );
  }

  const cliente = await acharOuCriarCliente({ telefone, nome });
  const supabase = getSupabase();

  const { data: reserva, error } = await supabase
    .from('reservas')
    .insert({
      cliente_id: cliente.id,
      data_reserva: pedido.data,
      horario: pedido.horario,
      pessoas: pedido.pessoas,
      ambiente_pref: ambiente,
      observacoes,
      status: 'Pendente',
      origem,
    })
    .select(SELECT_COM_CLIENTE)
    .single();

  if (error) {
    // 23505 = violação de índice único → já existe reserva igual.
    if (error.code === '23505') {
      throw new ErroDeReserva(
        `Você já tem uma reserva para ${formatarBR(pedido.data)} às ${pedido.horario}.`,
      );
    }
    throw new Error(`Erro ao criar reserva: ${error.message}`);
  }

  return reserva;
}

/** Reservas futuras de um telefone. */
export async function reservasDoCliente(telefone) {
  const supabase = getSupabase();
  const numero = String(telefone).replace(/\D/g, '');

  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('telefone', numero)
    .maybeSingle();

  if (!cliente) return [];

  const { data, error } = await supabase
    .from('reservas')
    .select(SELECT_COM_CLIENTE)
    .eq('cliente_id', cliente.id)
    .gte('data_reserva', hojeISO())
    .neq('status', 'Cancelada')
    .order('data_reserva', { ascending: true })
    .order('horario', { ascending: true });

  if (error) throw new Error(`Erro ao listar reservas: ${error.message}`);
  return data ?? [];
}

/**
 * Cancela uma reserva.
 * `telefone` restringe o cancelamento ao dono da reserva — sem isso, um cliente
 * poderia cancelar a reserva de outro só chutando um id.
 */
export async function cancelarReserva({ reservaId, telefone = null }) {
  const supabase = getSupabase();

  const { data: reserva, error: erroBusca } = await supabase
    .from('reservas')
    .select(SELECT_COM_CLIENTE)
    .eq('id', reservaId)
    .maybeSingle();

  if (erroBusca) throw new Error(`Erro ao buscar reserva: ${erroBusca.message}`);
  if (!reserva) throw new ErroDeReserva('Não encontrei essa reserva.');

  if (telefone) {
    const numero = String(telefone).replace(/\D/g, '');
    if (reserva.clientes?.telefone !== numero) {
      throw new ErroDeReserva('Não encontrei essa reserva no seu número.');
    }
  }

  const { data: atualizada, error } = await supabase
    .from('reservas')
    .update({ status: 'Cancelada' })
    .eq('id', reservaId)
    .select(SELECT_COM_CLIENTE)
    .single();

  if (error) throw new Error(`Erro ao cancelar: ${error.message}`);
  return atualizada;
}

/** Lista para o painel administrativo. */
export async function listarReservas({ de = null, ate = null, status = null } = {}) {
  const supabase = getSupabase();

  let consulta = supabase.from('reservas').select(SELECT_COM_CLIENTE);

  if (de) consulta = consulta.gte('data_reserva', de);
  if (ate) consulta = consulta.lte('data_reserva', ate);
  if (status) consulta = consulta.eq('status', status);

  const { data, error } = await consulta
    .order('data_reserva', { ascending: true })
    .order('horario', { ascending: true });

  if (error) throw new Error(`Erro ao listar reservas: ${error.message}`);
  return data ?? [];
}

/** Muda o status pelo painel. */
export async function atualizarStatus({ reservaId, status }) {
  if (!['Pendente', 'Confirmada', 'Cancelada'].includes(status)) {
    throw new ErroDeReserva('Status inválido.');
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('reservas')
    .update({ status })
    .eq('id', reservaId)
    .select(SELECT_COM_CLIENTE)
    .single();

  if (error) throw new Error(`Erro ao atualizar status: ${error.message}`);
  return data;
}

/** Exclui de vez (usado só pelo painel). */
export async function excluirReserva(reservaId) {
  const supabase = getSupabase();
  const { error } = await supabase.from('reservas').delete().eq('id', reservaId);
  if (error) throw new Error(`Erro ao excluir: ${error.message}`);
  return true;
}

/** Programação da casa numa data. */
export async function eventosDaData(data) {
  const supabase = getSupabase();
  const { data: linhas, error } = await supabase
    .from('eventos')
    .select('*')
    .eq('data', data)
    .order('data', { ascending: true });

  if (error) throw new Error(`Erro ao consultar programação: ${error.message}`);
  return linhas ?? [];
}
