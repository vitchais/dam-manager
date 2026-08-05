// ============================================================================
// src/services/conversas.js
// Memória do chatbot: uma conversa por telefone, com histórico de mensagens.
// ============================================================================

import { getSupabase } from '../lib/supabase.js';
import { env } from '../config/env.js';

/** Devolve (criando se preciso) a conversa daquele telefone. */
export async function acharOuCriarConversa({ telefone, clienteId = null }) {
  const supabase = getSupabase();
  const numero = String(telefone).replace(/\D/g, '');

  const { data: existente, error: erroBusca } = await supabase
    .from('conversas')
    .select('*')
    .eq('telefone', numero)
    .maybeSingle();

  if (erroBusca) throw new Error(`Erro ao buscar conversa: ${erroBusca.message}`);
  if (existente) return existente;

  const { data: criada, error } = await supabase
    .from('conversas')
    .insert({ telefone: numero, cliente_id: clienteId })
    .select()
    .single();

  if (error) throw new Error(`Erro ao criar conversa: ${error.message}`);
  return criada;
}

/**
 * Grava uma mensagem.
 * Se `waId` já existir, o insert bate no índice único e devolvemos `null` —
 * é assim que ignoramos webhooks reenviados pela Evolution.
 */
export async function registrarMensagem({ conversaId, papel, conteudo, waId = null }) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('mensagens')
    .insert({ conversa_id: conversaId, papel, conteudo, wa_id: waId })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return null; // duplicata: já processamos
    throw new Error(`Erro ao registrar mensagem: ${error.message}`);
  }

  await supabase
    .from('conversas')
    .update({ ultima_interacao: new Date().toISOString() })
    .eq('id', conversaId);

  return data;
}

/** Últimas N mensagens, em ordem cronológica, no formato que a OpenAI espera. */
export async function historico(conversaId, limite = env.chatbot.historyLimit) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('mensagens')
    .select('papel, conteudo')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: false })
    .limit(limite);

  if (error) throw new Error(`Erro ao ler histórico: ${error.message}`);

  return (data ?? [])
    .reverse()
    .map((linha) => ({ role: linha.papel, content: linha.conteudo }));
}

/**
 * Alterna entre atendimento automático e humano.
 * Quando um atendente assume, o bot para de responder aquele número.
 */
export async function definirModo({ telefone, modo }) {
  const supabase = getSupabase();
  const numero = String(telefone).replace(/\D/g, '');

  const { data, error } = await supabase
    .from('conversas')
    .update({ modo })
    .eq('telefone', numero)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Erro ao mudar modo: ${error.message}`);
  return data;
}
