// ============================================================================
// src/lib/supabase.js
//
// Cliente Supabase do SERVIDOR, criado com a chave service_role.
// Essa chave ignora as políticas de RLS, então este módulo NUNCA pode ser
// importado por código que vá parar no navegador.
//
// Se a credencial não estiver configurada, `getSupabase()` lança um erro com
// mensagem explicativa em vez de estourar um "undefined" lá na frente.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { env, features } from '../config/env.js';

let cliente = null;

export function getSupabase() {
  if (!features.supabase) {
    throw new Error(
      'Supabase não configurado: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  if (!cliente) {
    cliente = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
      auth: {
        // O servidor não tem sessão de usuário: nada para persistir ou renovar.
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return cliente;
}

/** Faz uma consulta trivial só para confirmar que a credencial funciona. */
export async function testarConexao() {
  const supabase = getSupabase();
  const { error } = await supabase.from('clientes').select('id').limit(1);
  if (error) throw new Error(`Supabase respondeu com erro: ${error.message}`);
  return true;
}
