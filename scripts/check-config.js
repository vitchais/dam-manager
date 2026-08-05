#!/usr/bin/env node
// ============================================================================
// scripts/check-config.js
//
//   npm run check
//
// Diz, em português claro, o que já está configurado e o que falta — e testa
// de verdade cada credencial em vez de só olhar se a variável existe.
// Roda sem subir o servidor.
// ============================================================================

import { env, features, pendencias } from '../src/config/env.js';

const OK = '\x1b[32m✓\x1b[0m';
const FALHA = '\x1b[31m✗\x1b[0m';
const AVISO = '\x1b[33m!\x1b[0m';

function titulo(texto) {
  console.log(`\n\x1b[1m${texto}\x1b[0m`);
}

async function testarSupabase() {
  if (!features.supabase) {
    const faltam = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
      (nome) => !process.env[nome]?.trim(),
    );
    console.log(`  ${FALHA} Supabase — falta ${faltam.join(', ')}`);
    return false;
  }
  try {
    const { testarConexao } = await import('../src/lib/supabase.js');
    await testarConexao();
    console.log(`  ${OK} Supabase — conectado e tabela "clientes" acessível`);
    return true;
  } catch (erro) {
    console.log(`  ${FALHA} Supabase — ${erro.message}`);
    console.log('      Se a tabela não existe, rode supabase/schema.sql no SQL Editor.');
    return false;
  }
}

async function testarOpenAI() {
  if (!features.openai) {
    console.log(`  ${FALHA} OpenAI — falta OPENAI_API_KEY`);
    return false;
  }
  try {
    const { default: OpenAI } = await import('openai');
    const cliente = new OpenAI({ apiKey: env.openai.apiKey });
    const modelos = await cliente.models.list();
    const existe = modelos.data.some((modelo) => modelo.id === env.openai.model);
    console.log(`  ${OK} OpenAI — chave válida`);
    if (!existe) {
      console.log(
        `  ${AVISO} O modelo "${env.openai.model}" não aparece na sua conta. Confira OPENAI_MODEL.`,
      );
    } else {
      console.log(`  ${OK} Modelo "${env.openai.model}" disponível`);
    }
    return true;
  } catch (erro) {
    console.log(`  ${FALHA} OpenAI — ${erro.message}`);
    return false;
  }
}

async function testarEvolution() {
  if (!features.evolution) {
    const faltam = ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY'].filter(
      (nome) => !process.env[nome]?.trim(),
    );
    console.log(`  ${FALHA} Evolution API — falta ${faltam.join(', ')}`);
    return false;
  }
  try {
    const { estadoInstancia } = await import('../src/lib/evolution.js');
    const estado = await estadoInstancia();
    const situacao = estado?.instance?.state ?? estado?.state ?? 'desconhecido';
    console.log(`  ${OK} Evolution API — respondendo em ${env.evolution.apiUrl}`);

    if (situacao === 'open') {
      console.log(`  ${OK} Instância "${env.evolution.instance}" conectada ao WhatsApp`);
    } else {
      console.log(
        `  ${AVISO} Instância "${env.evolution.instance}" está "${situacao}" — falta ler o QR Code.`,
      );
      console.log('      Rode: npm run setup:evolution');
    }
    return true;
  } catch (erro) {
    console.log(`  ${FALHA} Evolution API — ${erro.message}`);
    if (erro.message.includes('404')) {
      console.log('      A instância ainda não existe. Rode: npm run setup:evolution');
    }
    return false;
  }
}

async function principal() {
  console.log('\n\x1b[1m═══ DAM MANAGER — diagnóstico de configuração ═══\x1b[0m');
  console.log(`\nAmbiente: ${env.nodeEnv}   APP_URL: ${env.appUrl}   Fuso: ${env.timezone}`);

  titulo('Credenciais');
  await testarSupabase();
  await testarOpenAI();
  await testarEvolution();

  console.log(
    `  ${features.webhook ? OK : FALHA} WEBHOOK_TOKEN ${features.webhook ? 'definido' : '— gere com: openssl rand -hex 32'}`,
  );
  console.log(
    `  ${features.adminAuth ? OK : FALHA} ADMIN_PASSWORD ${features.adminAuth ? 'definida' : '— defina uma senha forte'}`,
  );

  titulo('Chatbot de WhatsApp');
  if (features.chatbot) {
    console.log(`  ${OK} Todas as peças estão no lugar.`);
    console.log(`      Webhook: ${env.appUrl}/webhook/evolution?token=***`);
  } else {
    console.log(`  ${FALHA} Ainda não funciona de ponta a ponta.`);
  }

  const faltando = pendencias();
  if (faltando.length > 0) {
    titulo('Falta preencher');
    for (const requisito of faltando) {
      console.log(`  • ${requisito.vars.join(', ')}`);
      console.log(`      ${requisito.porque}`);
      console.log(`      onde: ${requisito.onde}`);
    }
  }

  console.log('');
  process.exit(faltando.length === 0 ? 0 : 1);
}

principal().catch((erro) => {
  console.error('Erro no diagnóstico:', erro);
  process.exit(1);
});
