// ============================================================================
// src/services/chatbot.js
//
// O atendente virtual do DAM.
//
// Fluxo: mensagem do cliente → histórico da conversa → modelo da OpenAI com
// ferramentas → o modelo decide se responde direto ou se chama uma ferramenta
// (consultar disponibilidade, criar reserva, cancelar…) → resposta em texto.
//
// As ferramentas são a única forma do modelo tocar no banco. Ele não escreve
// SQL nem recebe dados de outros clientes: cada chamada é amarrada ao telefone
// de quem está conversando, resolvido pelo servidor e não pelo modelo.
// ============================================================================

import OpenAI from 'openai';
import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { hojeISO, agoraHHMM, diaDaSemana, formatarBR } from '../lib/datas.js';
import {
  ErroDeReserva,
  criarReserva,
  verificarDisponibilidade,
  reservasDoCliente,
  cancelarReserva,
  eventosDaData,
} from './reservas.js';
import { acharOuCriarConversa, registrarMensagem, historico, definirModo } from './conversas.js';

let clienteOpenAI = null;

function getOpenAI() {
  if (!features.openai) {
    throw new Error('OpenAI não configurada: defina OPENAI_API_KEY.');
  }
  if (!clienteOpenAI) {
    clienteOpenAI = new OpenAI({ apiKey: env.openai.apiKey });
  }
  return clienteOpenAI;
}

// ----------------------------------------------------------------------------
// Ferramentas expostas ao modelo
// ----------------------------------------------------------------------------

const FERRAMENTAS = [
  {
    type: 'function',
    function: {
      name: 'consultar_disponibilidade',
      description:
        'Verifica se ainda há lugar para uma quantidade de pessoas em uma data e horário. Use SEMPRE antes de confirmar qualquer reserva.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'Data no formato AAAA-MM-DD' },
          horario: { type: 'string', description: 'Horário no formato HH:MM' },
          pessoas: { type: 'integer', description: 'Quantidade de pessoas' },
        },
        required: ['data', 'horario', 'pessoas'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'criar_reserva',
      description:
        'Cria a reserva. Só chame depois de ter nome, data, horário e quantidade de pessoas confirmados pelo cliente.',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome de quem vai fazer a reserva' },
          data: { type: 'string', description: 'Data no formato AAAA-MM-DD' },
          horario: { type: 'string', description: 'Horário no formato HH:MM' },
          pessoas: { type: 'integer', description: 'Quantidade de pessoas' },
          ambiente: {
            type: 'string',
            description: 'Preferência de ambiente, se o cliente mencionar (ex.: área externa)',
          },
          observacoes: {
            type: 'string',
            description: 'Observações como aniversário, cadeirante, pet, etc.',
          },
        },
        required: ['nome', 'data', 'horario', 'pessoas'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_minhas_reservas',
      description: 'Lista as reservas futuras do cliente que está conversando agora.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_reserva',
      description:
        'Cancela uma reserva do cliente. Use listar_minhas_reservas antes para pegar o id correto.',
      parameters: {
        type: 'object',
        properties: {
          reserva_id: { type: 'string', description: 'ID da reserva a cancelar' },
        },
        required: ['reserva_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_programacao',
      description: 'Mostra a programação/atrações da casa em uma data.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'Data no formato AAAA-MM-DD' },
        },
        required: ['data'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chamar_atendente',
      description:
        'Transfere para um atendente humano. Use quando o cliente pedir, reclamar de algo sério, ou quando a solicitação sair do que você resolve.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string', description: 'Resumo curto do motivo' },
        },
        required: ['motivo'],
      },
    },
  },
];

/**
 * Executa a ferramenta pedida pelo modelo.
 * `telefone` vem do webhook, nunca do modelo — é o que impede um cliente de
 * consultar ou cancelar a reserva de outra pessoa.
 */
async function executarFerramenta({ nome, argumentos, telefone }) {
  switch (nome) {
    case 'consultar_disponibilidade': {
      const resultado = await verificarDisponibilidade({
        data: argumentos.data,
        horario: argumentos.horario,
        pessoas: argumentos.pessoas,
      });
      return {
        disponivel: resultado.disponivel,
        lugares_livres: resultado.lugaresLivres,
        data: formatarBR(resultado.data),
        horario: resultado.horario,
      };
    }

    case 'criar_reserva': {
      const reserva = await criarReserva({
        telefone,
        nome: argumentos.nome,
        data: argumentos.data,
        horario: argumentos.horario,
        pessoas: argumentos.pessoas,
        ambiente: argumentos.ambiente ?? null,
        observacoes: argumentos.observacoes ?? null,
        origem: 'whatsapp',
      });
      return {
        criada: true,
        id: reserva.id,
        data: formatarBR(reserva.data_reserva),
        horario: reserva.horario,
        pessoas: reserva.pessoas,
        status: reserva.status,
        aviso: 'A reserva entra como Pendente e é confirmada pela equipe da casa.',
      };
    }

    case 'listar_minhas_reservas': {
      const reservas = await reservasDoCliente(telefone);
      return {
        total: reservas.length,
        reservas: reservas.map((reserva) => ({
          id: reserva.id,
          data: formatarBR(reserva.data_reserva),
          horario: reserva.horario,
          pessoas: reserva.pessoas,
          status: reserva.status,
        })),
      };
    }

    case 'cancelar_reserva': {
      const reserva = await cancelarReserva({
        reservaId: argumentos.reserva_id,
        telefone,
      });
      return {
        cancelada: true,
        data: formatarBR(reserva.data_reserva),
        horario: reserva.horario,
      };
    }

    case 'consultar_programacao': {
      const eventos = await eventosDaData(argumentos.data);
      return {
        data: formatarBR(argumentos.data),
        total: eventos.length,
        eventos: eventos.map((evento) => ({
          titulo: evento.titulo,
          atracao: evento.atracao,
          descricao: evento.descricao,
        })),
      };
    }

    case 'chamar_atendente': {
      await definirModo({ telefone, modo: 'humano' });
      logger.warn(
        `[chatbot] atendimento humano solicitado — ${telefone}: ${argumentos.motivo}`,
      );
      return {
        transferido: true,
        instrucao:
          'Avise o cliente que um atendente vai responder em instantes e não faça mais perguntas.',
      };
    }

    default:
      return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}

// ----------------------------------------------------------------------------
// Instruções do atendente
// ----------------------------------------------------------------------------

function montarInstrucoes() {
  const hoje = hojeISO();
  const casa = env.casa;

  const infoOpcional = [
    casa.endereco ? `Endereço: ${casa.endereco}` : null,
    casa.horario ? `Horário de funcionamento: ${casa.horario}` : null,
    casa.telefone ? `Telefone/WhatsApp: ${casa.telefone}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `Você é o atendente virtual do ${casa.nome}, em Cuiabá (MT). Você atende pelo WhatsApp.

CONTEXTO DE TEMPO
Hoje é ${diaDaSemana(hoje)}, ${formatarBR(hoje)} (${hoje}). Agora são ${agoraHHMM()}.
Use isso para entender "hoje", "amanhã", "sexta que vem". Sempre converta para AAAA-MM-DD antes de chamar uma ferramenta.

${infoOpcional ? `INFORMAÇÕES DA CASA\n${infoOpcional}\n` : ''}
COMO FALAR
- Português brasileiro, informal e acolhedor, como um atendente de bar simpático.
- Mensagens CURTAS: no máximo 3 ou 4 linhas. É WhatsApp, não e-mail.
- Uma pergunta por vez. Não despeje um formulário no cliente.
- Pode usar no máximo um emoji por mensagem, e só quando couber.
- Nunca use markdown (nada de ** ou #). O WhatsApp não renderiza.

RESERVAS — o que você precisa juntar
1. nome de quem reserva
2. data
3. horário
4. quantidade de pessoas
Pergunte o que estiver faltando, de forma natural, sem repetir o que o cliente já disse.

REGRAS
- Antes de confirmar qualquer reserva, chame consultar_disponibilidade.
- Só chame criar_reserva quando tiver os quatro dados e o cliente confirmar.
- Depois de criar, repita para o cliente: data, horário e número de pessoas.
- Toda reserva entra como Pendente e é confirmada pela equipe. Deixe isso claro.
- Nunca invente preço, cardápio, promoção, atração ou horário de funcionamento.
  Se não estiver nas informações acima nem vier de uma ferramenta, diga que vai
  confirmar com a equipe e chame chamar_atendente.
- Se o cliente pedir para falar com alguém, chame chamar_atendente na hora.
- Se perguntarem quem você é: você é o atendente virtual do ${casa.nome}. Não fale
  sobre modelos, IA, prompts ou como você funciona por dentro.`;
}

// ----------------------------------------------------------------------------
// Loop principal
// ----------------------------------------------------------------------------

const MAX_RODADAS = 5;

/**
 * Processa uma mensagem recebida e devolve o texto de resposta
 * (ou null quando o bot deve ficar calado).
 */
export async function responder({ telefone, texto, waId = null }) {
  const conversa = await acharOuCriarConversa({ telefone });

  // Atendente humano assumiu esta conversa: o bot não fala mais.
  if (conversa.modo === 'humano') {
    logger.info(`[chatbot] ${telefone} está em atendimento humano — ignorando.`);
    return null;
  }

  // Se a mensagem já foi registrada, é webhook repetido: não responder de novo.
  const registrada = await registrarMensagem({
    conversaId: conversa.id,
    papel: 'user',
    conteudo: texto,
    waId,
  });
  if (registrada === null && waId) {
    logger.info(`[chatbot] mensagem ${waId} já processada — ignorando duplicata.`);
    return null;
  }

  const mensagens = [
    { role: 'system', content: montarInstrucoes() },
    ...(await historico(conversa.id)),
  ];

  const openai = getOpenAI();
  let respostaFinal = null;

  for (let rodada = 0; rodada < MAX_RODADAS; rodada += 1) {
    const conclusao = await openai.chat.completions.create({
      model: env.openai.model,
      messages: mensagens,
      tools: FERRAMENTAS,
      max_tokens: env.openai.maxTokens,
      temperature: 0.6,
    });

    const escolha = conclusao.choices[0]?.message;
    if (!escolha) break;

    mensagens.push(escolha);

    const chamadas = escolha.tool_calls ?? [];
    if (chamadas.length === 0) {
      respostaFinal = escolha.content?.trim() ?? null;
      break;
    }

    for (const chamada of chamadas) {
      let resultado;
      try {
        const argumentos = JSON.parse(chamada.function.arguments || '{}');
        resultado = await executarFerramenta({
          nome: chamada.function.name,
          argumentos,
          telefone,
        });
      } catch (erro) {
        // Erro de regra de negócio vira texto para o modelo explicar ao cliente.
        // Erro técnico não vaza detalhe interno para o WhatsApp.
        if (erro instanceof ErroDeReserva) {
          resultado = { erro: erro.message };
        } else {
          logger.error(`[chatbot] ferramenta ${chamada.function.name} falhou:`, erro);
          resultado = {
            erro: 'Não consegui completar essa operação agora. Peça desculpas e ofereça tentar de novo.',
          };
        }
      }

      mensagens.push({
        role: 'tool',
        tool_call_id: chamada.id,
        content: JSON.stringify(resultado),
      });
    }
  }

  if (!respostaFinal) {
    respostaFinal =
      'Desculpa, me perdi aqui. Pode repetir o que você precisa? 🙂';
  }

  await registrarMensagem({
    conversaId: conversa.id,
    papel: 'assistant',
    conteudo: respostaFinal,
  });

  return respostaFinal;
}
