// ============================================================================
// src/config/env.js
//
// Ponto único de leitura de variáveis de ambiente.
//
// Regra de ouro deste arquivo:
//   * em DESENVOLVIMENTO, faltar credencial NÃO derruba o servidor — o recurso
//     correspondente é desligado e um aviso claro é impresso no console. Assim
//     `npm run dev` sempre sobe, mesmo antes de você ter todas as chaves.
//   * em PRODUÇÃO (NODE_ENV=production), faltar credencial essencial derruba o
//     processo na hora, com a lista exata do que falta. É melhor o deploy falhar
//     do que o chatbot ficar no ar respondendo errado.
// ============================================================================

import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';

function str(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function int(name, fallback) {
  const raw = str(name);
  if (raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name, fallback) {
  const raw = str(name).toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'sim';
}

function list(name) {
  return str(name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Tira a barra final para que possamos concatenar caminhos sem gerar "//".
function url(name, fallback = '') {
  return str(name, fallback).replace(/\/+$/, '');
}

export const env = {
  isProduction,
  nodeEnv: str('NODE_ENV', 'development'),
  port: int('PORT', 3000),
  appUrl: url('APP_URL', 'http://localhost:3000'),
  timezone: str('TZ', 'America/Cuiaba'),

  supabase: {
    url: url('SUPABASE_URL'),
    anonKey: str('SUPABASE_ANON_KEY'),
    serviceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),
  },

  openai: {
    apiKey: str('OPENAI_API_KEY'),
    model: str('OPENAI_MODEL', 'gpt-4o-mini'),
    maxTokens: int('OPENAI_MAX_TOKENS', 600),
  },

  evolution: {
    apiUrl: url('EVOLUTION_API_URL'),
    apiKey: str('EVOLUTION_API_KEY'),
    instance: str('EVOLUTION_INSTANCE', 'dam'),
    webhookToken: str('WEBHOOK_TOKEN'),
  },

  chatbot: {
    enabled: bool('CHATBOT_ENABLED', true),
    ignoreNumbers: list('CHATBOT_IGNORE_NUMBERS'),
    debounceSeconds: int('CHATBOT_DEBOUNCE_SECONDS', 6),
    historyLimit: int('CHATBOT_HISTORY_LIMIT', 20),
  },

  admin: {
    password: str('ADMIN_PASSWORD'),
  },

  casa: {
    nome: str('CASA_NOME', 'DAM Gastrobar'),
    telefone: str('CASA_TELEFONE', ''),
    endereco: str('CASA_ENDERECO', ''),
    horario: str('CASA_HORARIO', ''),
    capacidadeMaxima: int('CASA_CAPACIDADE_MAXIMA', 120),
  },

  reserva: {
    antecedenciaHoras: int('RESERVA_ANTECEDENCIA_HORAS', 2),
    janelaDias: int('RESERVA_JANELA_DIAS', 60),
  },
};

// ----------------------------------------------------------------------------
// Recursos: cada um só liga se TODAS as suas variáveis estiverem preenchidas.
// O resto da aplicação consulta `features.x` em vez de checar env solto.
// ----------------------------------------------------------------------------

export const features = {
  // Leitura/escrita no banco pelo servidor (bot e API do painel).
  supabase: Boolean(env.supabase.url && env.supabase.serviceRoleKey),
  // Cliente público do Supabase entregue ao navegador (painel admin).
  supabasePublic: Boolean(env.supabase.url && env.supabase.anonKey),
  // Geração de respostas com IA.
  openai: Boolean(env.openai.apiKey),
  // Envio de mensagens de WhatsApp.
  evolution: Boolean(env.evolution.apiUrl && env.evolution.apiKey),
  // Recebimento de mensagens de WhatsApp.
  webhook: Boolean(env.evolution.webhookToken),
  // Proteção por senha do painel.
  adminAuth: Boolean(env.admin.password),
};

// O chatbot só funciona de ponta a ponta com as quatro peças no lugar.
features.chatbot =
  env.chatbot.enabled &&
  features.supabase &&
  features.openai &&
  features.evolution &&
  features.webhook;

// ----------------------------------------------------------------------------
// Diagnóstico
// ----------------------------------------------------------------------------

// Cada item: o que falta, por que importa e onde conseguir.
const REQUISITOS = [
  {
    vars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    ok: () => features.supabase,
    porque: 'sem isto o servidor não lê nem grava reservas no banco',
    onde: 'Supabase → Project Settings → API → service_role / secret key',
    critico: true,
  },
  {
    vars: ['OPENAI_API_KEY'],
    ok: () => features.openai,
    porque: 'sem isto o chatbot não consegue gerar respostas',
    onde: 'https://platform.openai.com/api-keys',
    critico: true,
  },
  {
    vars: ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY'],
    ok: () => features.evolution,
    porque: 'sem isto o bot não envia mensagens no WhatsApp',
    onde: 'serviço Evolution API no Railway (ver docs/EVOLUTION-RAILWAY.md)',
    critico: true,
  },
  {
    vars: ['WEBHOOK_TOKEN'],
    ok: () => features.webhook,
    porque: 'sem isto o endpoint /webhook/evolution fica desprotegido e desligado',
    onde: 'gere você mesmo: openssl rand -hex 32',
    critico: true,
  },
  {
    vars: ['ADMIN_PASSWORD'],
    ok: () => features.adminAuth,
    porque: 'sem isto o painel administrativo fica aberto para qualquer pessoa',
    onde: 'defina uma senha forte',
    critico: true,
  },
];

/**
 * Lista os requisitos ainda não atendidos.
 * `vars` traz só as variáveis realmente vazias — se SUPABASE_URL já está
 * preenchida e só falta a service_role, não faz sentido mandar o usuário
 * procurar as duas.
 */
export function pendencias() {
  return REQUISITOS.filter((req) => !req.ok()).map((req) => {
    const vazias = req.vars.filter((nome) => str(nome) === '');
    return { ...req, vars: vazias.length > 0 ? vazias : req.vars };
  });
}

/**
 * Valida a configuração.
 * Em produção, aborta o processo se algo crítico estiver faltando.
 * Em desenvolvimento, apenas avisa e devolve a lista de pendências.
 */
export function validarConfiguracao({ logger = console } = {}) {
  const faltando = pendencias();

  if (faltando.length === 0) {
    logger.info('[config] Todas as credenciais estão presentes.');
    return faltando;
  }

  const criticas = faltando.filter((req) => req.critico);

  if (isProduction && criticas.length > 0) {
    logger.error('[config] Configuração incompleta — abortando em produção.\n');
    for (const req of criticas) {
      logger.error(`  ✗ ${req.vars.join(', ')}`);
      logger.error(`      ${req.porque}`);
      logger.error(`      onde conseguir: ${req.onde}\n`);
    }
    logger.error('Preencha as variáveis no painel do Railway e faça o redeploy.');
    process.exit(1);
  }

  logger.warn('\n[config] Rodando em modo parcial. Faltam variáveis:\n');
  for (const req of faltando) {
    logger.warn(`  ✗ ${req.vars.join(', ')} — ${req.porque}`);
    logger.warn(`      onde conseguir: ${req.onde}`);
  }
  logger.warn('\nO servidor sobe assim mesmo; os recursos acima ficam desligados.');
  logger.warn('Rode `npm run check` para ver este relatório a qualquer momento.\n');

  return faltando;
}
