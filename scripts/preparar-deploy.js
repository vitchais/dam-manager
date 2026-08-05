#!/usr/bin/env node
// ============================================================================
// scripts/preparar-deploy.js
//
//   node scripts/preparar-deploy.js
//
// Monta toda a configuração de produção de uma vez, para você não ter que
// digitar variável por variável no painel do Railway (onde um "/" a mais no
// fim de uma URL já quebra a integração).
//
// O que ele faz:
//   1. gera sozinho os segredos que não vêm de lugar nenhum
//      (WEBHOOK_TOKEN, AUTHENTICATION_API_KEY da Evolution, senha do painel);
//   2. pergunta só o que ele não tem como adivinhar;
//   3. escreve dois arquivos prontos para colar no "Raw Editor" do Railway,
//      um para cada serviço;
//   4. escreve um .env local, para você rodar `npm run check` e testar antes.
//
// Os arquivos gerados contêm segredos e já entram no .gitignore.
// ============================================================================

import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';

const ARQUIVO_APP = 'railway-app.env';
const ARQUIVO_EVOLUTION = 'railway-evolution.env';

const negrito = (t) => `\x1b[1m${t}\x1b[0m`;
const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const amarelo = (t) => `\x1b[33m${t}\x1b[0m`;
const cinza = (t) => `\x1b[90m${t}\x1b[0m`;

/** Segredo aleatório em hexadecimal — mesmo formato de `openssl rand -hex n`. */
function segredo(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

/** Senha legível para humano digitar, mas ainda difícil de adivinhar. */
function senhaLegivel() {
  // Sem caracteres ambíguos (0/O, 1/l/I) — a equipe vai digitar isso no celular.
  const alfabeto = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bruto = randomBytes(20);
  return Array.from(bruto, (b) => alfabeto[b % alfabeto.length]).join('');
}

/** Tira a barra final: URL com "/" no fim gera "//" nas chamadas. */
function limparUrl(valor) {
  return String(valor ?? '').trim().replace(/\/+$/, '');
}

/** Lê um .env existente para reaproveitar o que já estiver preenchido. */
function lerEnvExistente(caminho) {
  if (!existsSync(caminho)) return {};
  const mapa = {};
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const igual = limpa.indexOf('=');
    if (igual < 1) continue;
    mapa[limpa.slice(0, igual).trim()] = limpa.slice(igual + 1).trim();
  }
  return mapa;
}

/** Lê stdin inteiro. Usado quando a entrada é um pipe, não um terminal. */
function lerStdinTodo() {
  try {
    return readFileSync(0, 'utf8').split('\n');
  } catch {
    return [];
  }
}

async function principal() {
  const anterior = lerEnvExistente('.env');

  // Interativo num terminal; em pipe (testes, scripts) lemos as linhas de uma
  // vez — com readline, a entrada canalizada trava depois do EOF.
  const interativo = Boolean(stdin.isTTY);
  const rl = interativo ? createInterface({ input: stdin, output: stdout }) : null;
  const linhas = interativo ? null : lerStdinTodo();

  /** Pergunta com valor padrão; Enter aceita o padrão. */
  async function perguntar(rotulo, { padrao = '', obrigatorio = false, dica = '' } = {}) {
    for (;;) {
      if (dica) console.log(cinza(`   ${dica}`));
      const sufixo = padrao ? cinza(` [${padrao}]`) : '';

      let resposta;
      if (interativo) {
        resposta = (await rl.question(`${rotulo}${sufixo}: `)).trim();
      } else {
        resposta = (linhas.shift() ?? '').trim();
        console.log(`${rotulo}${sufixo}: ${resposta}`);
      }

      const valor = resposta || padrao;
      if (valor || !obrigatorio) return valor;

      console.log(amarelo('   Esse campo é obrigatório.\n'));
      // Sem terminal não adianta insistir: não há quem responda de novo.
      if (!interativo) return valor;
    }
  }

  console.log(negrito('\n═══ Preparar deploy do DAM Manager ═══\n'));
  console.log('Enter aceita o valor entre colchetes. Deixe em branco o que ainda não souber —');
  console.log('dá para rodar este script de novo depois que os domínios existirem.\n');

  // --- Supabase -------------------------------------------------------------
  console.log(negrito('\n1) Supabase'));
  const supabaseUrl = limparUrl(
    await perguntar('URL do projeto', {
      padrao: anterior.SUPABASE_URL || 'https://sfrovrevzqrfrmmlmpyi.supabase.co',
    }),
  );
  const serviceRole = await perguntar('Chave service_role', {
    padrao: anterior.SUPABASE_SERVICE_ROLE_KEY || '',
    dica: 'Supabase → Project Settings → API → service_role (a secreta, não a anon)',
  });

  // --- OpenAI ---------------------------------------------------------------
  console.log(negrito('\n2) OpenAI'));
  const openaiKey = await perguntar('OPENAI_API_KEY', {
    padrao: anterior.OPENAI_API_KEY || '',
    dica: 'https://platform.openai.com/api-keys — começa com sk-',
  });
  const openaiModel = await perguntar('Modelo', {
    padrao: anterior.OPENAI_MODEL || 'gpt-4o-mini',
  });

  // --- Domínios -------------------------------------------------------------
  console.log(negrito('\n3) Domínios do Railway'));
  console.log(cinza('   Se ainda não gerou, deixe em branco e rode este script de novo depois.'));
  const appUrl = limparUrl(
    await perguntar('URL do app (dam-manager)', {
      padrao: anterior.APP_URL && !anterior.APP_URL.includes('localhost') ? anterior.APP_URL : '',
      dica: 'ex.: https://dam-manager-production.up.railway.app',
    }),
  );
  const evolutionUrl = limparUrl(
    await perguntar('URL da Evolution API', {
      padrao: anterior.EVOLUTION_API_URL || '',
      dica: 'ex.: https://evolution-api-production.up.railway.app',
    }),
  );

  // --- Dados da casa --------------------------------------------------------
  console.log(negrito('\n4) Dados do DAM (o bot usa isso para responder)'));
  console.log(cinza('   O que ficar vazio, o bot é instruído a não responder em vez de inventar.'));
  const casaNome = await perguntar('Nome', { padrao: anterior.CASA_NOME || 'DAM Gastrobar' });
  const casaTelefone = await perguntar('WhatsApp (com DDI)', {
    padrao: anterior.CASA_TELEFONE || '5565993378770',
  });
  const casaEndereco = await perguntar('Endereço completo', {
    padrao: anterior.CASA_ENDERECO || '',
    dica: 'ex.: Av. Duque de Caxias, 000 — Bairro, Cuiabá/MT',
  });
  const casaHorario = await perguntar('Horário de funcionamento', {
    padrao: anterior.CASA_HORARIO || '',
    dica: 'ex.: Ter a Dom, 18h às 00h. Segunda fechado.',
  });
  const capacidade = await perguntar('Capacidade máxima (lugares)', {
    padrao: anterior.CASA_CAPACIDADE_MAXIMA || '120',
  });

  // --- Segredos gerados -----------------------------------------------------
  // Reaproveita o que já existe: trocar o token do webhook depois de conectado
  // derrubaria a integração até reconfigurar a Evolution.
  const webhookToken = anterior.WEBHOOK_TOKEN || segredo(32);
  const adminPassword = anterior.ADMIN_PASSWORD || senhaLegivel();
  const evolutionKey = anterior.EVOLUTION_API_KEY || segredo(32);
  const instancia = anterior.EVOLUTION_INSTANCE || 'dam';

  rl?.close();

  // --- Arquivos -------------------------------------------------------------
  const blocoApp = `# Cole em: Railway → serviço dam-manager → Variables → Raw Editor
NODE_ENV=production
APP_URL=${appUrl || '# PREENCHA depois de gerar o domínio do app'}
TZ=America/Cuiaba

SUPABASE_URL=${supabaseUrl}
SUPABASE_SERVICE_ROLE_KEY=${serviceRole || '# PREENCHA'}

OPENAI_API_KEY=${openaiKey || '# PREENCHA'}
OPENAI_MODEL=${openaiModel}
OPENAI_MAX_TOKENS=600

EVOLUTION_API_URL=${evolutionUrl || '# PREENCHA depois de gerar o domínio da Evolution'}
EVOLUTION_API_KEY=${evolutionKey}
EVOLUTION_INSTANCE=${instancia}
WEBHOOK_TOKEN=${webhookToken}

CHATBOT_ENABLED=true
CHATBOT_DEBOUNCE_SECONDS=6
CHATBOT_HISTORY_LIMIT=20
CHATBOT_IGNORE_NUMBERS=

ADMIN_PASSWORD=${adminPassword}

CASA_NOME=${casaNome}
CASA_TELEFONE=${casaTelefone}
CASA_ENDERECO=${casaEndereco}
CASA_HORARIO=${casaHorario}
CASA_CAPACIDADE_MAXIMA=${capacidade}

RESERVA_ANTECEDENCIA_HORAS=2
RESERVA_JANELA_DIAS=60
`;

  const blocoEvolution = `# Cole em: Railway → serviço evolution-api → Variables → Raw Editor
SERVER_URL=https://\${{RAILWAY_PUBLIC_DOMAIN}}
AUTHENTICATION_API_KEY=${evolutionKey}

DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=\${{Postgres.DATABASE_URL}}
DATABASE_CONNECTION_CLIENT_NAME=evolution

DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false

CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true

DEL_INSTANCE=false
LOG_LEVEL=ERROR,WARN,INFO
LOG_BAILEYS=error
TELEMETRY_ENABLED=false
`;

  const envLocal = blocoApp
    .replace('# Cole em: Railway → serviço dam-manager → Variables → Raw Editor', '# Gerado por scripts/preparar-deploy.js — uso local')
    .replace('NODE_ENV=production', 'NODE_ENV=development')
    .replace(/^APP_URL=.*$/m, `APP_URL=${appUrl || 'http://localhost:3000'}`);

  writeFileSync(ARQUIVO_APP, blocoApp);
  writeFileSync(ARQUIVO_EVOLUTION, blocoEvolution);
  writeFileSync('.env', `PORT=3000\n${envLocal}`);

  // --- Relatório ------------------------------------------------------------
  console.log(negrito('\n\n═══ Pronto ═══\n'));
  console.log(`${verde('✓')} ${negrito(ARQUIVO_APP)}       → cole no serviço ${negrito('dam-manager')}`);
  console.log(`${verde('✓')} ${negrito(ARQUIVO_EVOLUTION)} → cole no serviço ${negrito('evolution-api')}`);
  console.log(`${verde('✓')} ${negrito('.env')}                  → para rodar e testar localmente\n`);

  console.log(negrito('Anote a senha do painel (ela não aparece de novo em lugar nenhum):\n'));
  console.log(`   ${negrito(adminPassword)}\n`);
  console.log(cinza('   Serve para /admin.html e /whatsapp.html.\n'));

  const faltando = [];
  if (!serviceRole) faltando.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!openaiKey) faltando.push('OPENAI_API_KEY');
  if (!appUrl) faltando.push('APP_URL');
  if (!evolutionUrl) faltando.push('EVOLUTION_API_URL');
  if (!casaEndereco) faltando.push('CASA_ENDERECO');
  if (!casaHorario) faltando.push('CASA_HORARIO');

  if (faltando.length > 0) {
    console.log(amarelo(negrito('Ainda falta preencher:')));
    for (const nome of faltando) console.log(amarelo(`   • ${nome}`));
    console.log(cinza('\n   Rode este script de novo quando tiver esses valores —'));
    console.log(cinza('   ele reaproveita tudo que você já respondeu.\n'));
  } else {
    console.log(`${verde('✓')} Nada faltando. Rode ${negrito('npm run check')} para validar as credenciais.\n`);
  }

  console.log(negrito('Próximos passos:'));
  console.log('   1. cole os dois blocos nas Variables dos serviços correspondentes');
  console.log('   2. aguarde o redeploy dos dois');
  console.log(`   3. abra ${negrito('<app>/whatsapp.html')} e conecte o número\n`);
  console.log(amarelo('   Os arquivos .env gerados têm segredos: não faça commit deles.'));
  console.log(cinza('   (já estão no .gitignore)\n'));
}

principal().catch((erro) => {
  console.error('\nErro:', erro.message, '\n');
  process.exit(1);
});
