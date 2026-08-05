// ============================================================================
// src/server.js
//
// Um único processo serve tudo:
//   /                    site do DAM (public/index.html)
//   /admin.html          painel de reservas (protegido por senha)
//   /api/*               API do painel
//   /webhook/evolution   entrada das mensagens de WhatsApp
//   /health, /status     monitoramento
//
// Servimos `public/` — e não a raiz do repositório — de propósito: servindo a
// raiz, o arquivo .env e o diretório src/ ficariam acessíveis pela web.
// ============================================================================

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env, features, validarConfiguracao } from './config/env.js';
import { logger } from './lib/logger.js';
import { webhookRouter } from './routes/webhook.js';
import { apiRouter } from './routes/api.js';
import { healthRouter } from './routes/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIRETORIO_PUBLICO = path.join(__dirname, '..', 'public');

const app = express();

// O Railway roda atrás de proxy: sem isso, req.ip e o protocolo saem errados.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// O payload da Evolution pode carregar mídia em base64.
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  // O painel não pode ser indexado nem cacheado por proxies.
  if (req.path.startsWith('/api') || req.path === '/admin.html') {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

app.use(healthRouter);
app.use('/api', apiRouter);
app.use('/webhook', webhookRouter);

app.use(
  express.static(DIRETORIO_PUBLICO, {
    extensions: ['html'],
    maxAge: env.isProduction ? '1h' : 0,
  }),
);

app.use((req, res) => {
  res.status(404).sendFile(path.join(DIRETORIO_PUBLICO, 'index.html'));
});

// Handler de erro do Express (4 argumentos são obrigatórios para ele registrar).
// eslint-disable-next-line no-unused-vars
app.use((erro, req, res, next) => {
  logger.error('[server] erro não tratado:', erro);
  res.status(500).json({ erro: 'Erro interno.' });
});

function resumo() {
  const marca = (ligado) => (ligado ? '✓' : '✗');
  logger.info('');
  logger.info(`  ${env.casa.nome} — DAM Manager`);
  logger.info(`  Ambiente: ${env.nodeEnv}   Fuso: ${env.timezone}`);
  logger.info(`  Site:     http://localhost:${env.port}/`);
  logger.info(`  Painel:   http://localhost:${env.port}/admin.html`);
  logger.info(`  Status:   http://localhost:${env.port}/status`);
  logger.info('');
  logger.info('  Recursos:');
  logger.info(`    ${marca(features.supabase)} Supabase (banco de reservas)`);
  logger.info(`    ${marca(features.openai)} OpenAI (respostas do bot)`);
  logger.info(`    ${marca(features.evolution)} Evolution API (envio no WhatsApp)`);
  logger.info(`    ${marca(features.webhook)} Webhook protegido (recebimento)`);
  logger.info(`    ${marca(features.adminAuth)} Senha do painel`);
  logger.info(`    ${marca(features.chatbot)} CHATBOT COMPLETO`);
  logger.info('');
}

validarConfiguracao({ logger });

const servidor = app.listen(env.port, () => {
  resumo();
  logger.info(`Servidor ouvindo na porta ${env.port}.`);
});

// O Railway manda SIGTERM no redeploy; encerrar limpo evita cortar uma
// resposta no meio e deixar o cliente sem retorno.
function encerrar(sinal) {
  logger.info(`[server] ${sinal} recebido, encerrando...`);
  servidor.close(() => {
    logger.info('[server] encerrado.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));

process.on('unhandledRejection', (motivo) => {
  logger.error('[server] promessa rejeitada sem tratamento:', motivo);
});

export { app };
