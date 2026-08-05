#!/usr/bin/env node
// ============================================================================
// scripts/setup-evolution.js
//
//   npm run setup:evolution
//
// Faz, de uma vez, o que normalmente se faz na mão no Manager da Evolution:
//   1. cria a instância (se ainda não existir)
//   2. aponta o webhook para APP_URL/webhook/evolution?token=WEBHOOK_TOKEN
//   3. mostra o QR Code para você parear o WhatsApp do DAM
//
// Pode rodar quantas vezes quiser: se a instância já existe, ele só reconfigura
// o webhook e mostra o estado atual.
// ============================================================================

import { writeFileSync } from 'node:fs';
import { env, features } from '../src/config/env.js';
import {
  criarInstancia,
  definirWebhook,
  conectarInstancia,
  estadoInstancia,
} from '../src/lib/evolution.js';

const OK = '\x1b[32m✓\x1b[0m';
const FALHA = '\x1b[31m✗\x1b[0m';

function abortar(mensagem) {
  console.error(`\n${FALHA} ${mensagem}\n`);
  process.exit(1);
}

async function principal() {
  console.log('\n\x1b[1m═══ Configuração da Evolution API ═══\x1b[0m\n');

  if (!features.evolution) {
    abortar(
      'Faltam EVOLUTION_API_URL e/ou EVOLUTION_API_KEY no .env.\n' +
        '  Crie o serviço no Railway primeiro — veja docs/EVOLUTION-RAILWAY.md',
    );
  }

  if (!features.webhook) {
    abortar(
      'Falta WEBHOOK_TOKEN no .env.\n' +
        '  Gere um valor com:  openssl rand -hex 32',
    );
  }

  if (env.appUrl.includes('localhost')) {
    console.log(
      '\x1b[33m!\x1b[0m APP_URL aponta para localhost. A Evolution API, rodando no\n' +
        '  Railway, não consegue chamar o seu computador. Para testar localmente,\n' +
        '  exponha a porta com um túnel (ex.: ngrok) e coloque a URL pública em\n' +
        '  APP_URL. Em produção, use a URL do Railway.\n',
    );
  }

  // 1. Instância -------------------------------------------------------------
  console.log(`Criando instância "${env.evolution.instance}"...`);
  try {
    await criarInstancia();
    console.log(`${OK} Instância criada.`);
  } catch (erro) {
    // A Evolution devolve 403 quando o nome já está em uso — isso é esperado
    // em toda execução depois da primeira.
    if (erro.message.includes('403') || erro.message.toLowerCase().includes('already')) {
      console.log(`${OK} Instância já existia — seguindo em frente.`);
    } else {
      abortar(`Não consegui criar a instância: ${erro.message}`);
    }
  }

  // 2. Webhook ---------------------------------------------------------------
  const destino = `${env.appUrl}/webhook/evolution?token=${env.evolution.webhookToken}`;
  console.log(`\nApontando o webhook para ${env.appUrl}/webhook/evolution ...`);
  try {
    await definirWebhook({ urlDestino: destino });
    console.log(`${OK} Webhook configurado (eventos MESSAGES_UPSERT e CONNECTION_UPDATE).`);
  } catch (erro) {
    abortar(`Não consegui configurar o webhook: ${erro.message}`);
  }

  // 3. Conexão ---------------------------------------------------------------
  console.log('\nVerificando conexão com o WhatsApp...');
  let situacao = 'desconhecido';
  try {
    const estado = await estadoInstancia();
    situacao = estado?.instance?.state ?? estado?.state ?? 'desconhecido';
  } catch {
    situacao = 'desconhecido';
  }

  if (situacao === 'open') {
    console.log(`${OK} O número já está conectado. Nada mais a fazer.\n`);
    return;
  }

  console.log('Gerando QR Code para parear o celular...\n');
  const conexao = await conectarInstancia();
  const base64 = conexao?.base64 ?? conexao?.qrcode?.base64 ?? null;
  const codigo = conexao?.code ?? conexao?.qrcode?.code ?? null;

  if (base64) {
    // O QR chega como data URI; salvamos como arquivo para você abrir e escanear.
    const limpo = base64.replace(/^data:image\/png;base64,/, '');
    const arquivo = 'qrcode-whatsapp.png';
    writeFileSync(arquivo, Buffer.from(limpo, 'base64'));
    console.log(`${OK} QR Code salvo em ./${arquivo}`);
    console.log('   Abra o arquivo e escaneie com o WhatsApp do DAM:');
    console.log('   WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho\n');
  } else if (codigo) {
    console.log('Código de pareamento:', codigo, '\n');
  } else {
    console.log(
      'Não veio QR Code na resposta. Abra o Manager da Evolution API no navegador:\n' +
        `  ${env.evolution.apiUrl}/manager\n` +
        '  Entre com a AUTHENTICATION_API_KEY e escaneie o QR por lá.\n',
    );
  }

  console.log('Depois de escanear, confirme com:  npm run check\n');
}

principal().catch((erro) => {
  console.error(`\n${FALHA} ${erro.message}\n`);
  process.exit(1);
});
