// ============================================================================
// src/routes/whatsapp.js
//
// Conexão do WhatsApp pelo navegador, sem precisar de terminal.
//
// A página /whatsapp.html usa estes endpoints para:
//   • mostrar se o número está conectado;
//   • criar a instância e cadastrar o webhook (um clique);
//   • exibir o QR Code para parear o celular;
//   • desconectar o número.
//
// Tudo protegido pela mesma ADMIN_PASSWORD do painel: estes endpoints mexem na
// conexão do WhatsApp da casa, não podem ficar abertos.
// ============================================================================

import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';
import {
  criarInstancia,
  definirWebhook,
  conectarInstancia,
  estadoInstancia,
} from '../lib/evolution.js';

export const whatsappRouter = express.Router();

function senhaConfere(informada) {
  const esperada = env.admin.password;
  if (!esperada || !informada) return false;
  const a = Buffer.from(String(informada));
  const b = Buffer.from(esperada);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function exigirAdmin(req, res, next) {
  if (!features.adminAuth) {
    return res.status(503).json({
      erro: 'ADMIN_PASSWORD não configurada no servidor.',
    });
  }
  if (!senhaConfere(req.get('x-admin-password') ?? '')) {
    return res.status(401).json({ erro: 'Senha inválida.' });
  }
  return next();
}

function exigirEvolution(req, res, next) {
  if (!features.evolution) {
    return res.status(503).json({
      erro:
        'Evolution API não configurada. Preencha EVOLUTION_API_URL e EVOLUTION_API_KEY nas variáveis do Railway e faça o redeploy.',
    });
  }
  return next();
}

/** Lê o estado da conexão sem estourar erro se a instância ainda não existe. */
async function lerEstado() {
  try {
    const resposta = await estadoInstancia();
    const situacao = resposta?.instance?.state ?? resposta?.state ?? 'desconhecido';
    return { existe: true, estado: situacao, conectado: situacao === 'open' };
  } catch (erro) {
    // 404 = instância ainda não criada. Qualquer outra coisa é problema real.
    if (erro.message.includes('404')) {
      return { existe: false, estado: 'inexistente', conectado: false };
    }
    return { existe: false, estado: 'erro', conectado: false, erro: erro.message };
  }
}

// Situação atual, para a página desenhar a tela certa.
whatsappRouter.get('/status', exigirAdmin, async (req, res) => {
  if (!features.evolution) {
    return res.json({
      configurado: false,
      pendencias: {
        evolution: !features.evolution,
        webhookToken: !features.webhook,
        supabase: !features.supabase,
        openai: !features.openai,
      },
      instancia: env.evolution.instance,
    });
  }

  const estado = await lerEstado();

  return res.json({
    configurado: true,
    instancia: env.evolution.instance,
    appUrl: env.appUrl,
    chatbotCompleto: features.chatbot,
    pendencias: {
      evolution: !features.evolution,
      webhookToken: !features.webhook,
      supabase: !features.supabase,
      openai: !features.openai,
    },
    ...estado,
  });
});

/**
 * Cria a instância (se não existir) e cadastra o webhook.
 * Pode ser chamado quantas vezes quiser.
 */
whatsappRouter.post('/setup', exigirAdmin, exigirEvolution, async (req, res) => {
  if (!features.webhook) {
    return res.status(503).json({
      erro: 'WEBHOOK_TOKEN não configurado. Sem ele o webhook fica desprotegido.',
    });
  }

  const passos = [];

  try {
    await criarInstancia();
    passos.push('Instância criada.');
  } catch (erro) {
    if (erro.message.includes('403') || erro.message.toLowerCase().includes('already')) {
      passos.push('Instância já existia.');
    } else {
      logger.error('[whatsapp] falha ao criar instância:', erro);
      return res.status(502).json({ erro: `Não consegui criar a instância: ${erro.message}` });
    }
  }

  try {
    await definirWebhook();
    passos.push(`Webhook apontado para ${env.appUrl}/webhook/evolution`);
  } catch (erro) {
    logger.error('[whatsapp] falha ao definir webhook:', erro);
    return res.status(502).json({ erro: `Não consegui cadastrar o webhook: ${erro.message}` });
  }

  const estado = await lerEstado();
  return res.json({ ok: true, passos, ...estado });
});

/** Devolve o QR Code em base64 para a página exibir. */
whatsappRouter.get('/qrcode', exigirAdmin, exigirEvolution, async (req, res) => {
  try {
    const estado = await lerEstado();
    if (estado.conectado) {
      return res.json({ conectado: true, qrcode: null });
    }

    const conexao = await conectarInstancia();
    const base64 = conexao?.base64 ?? conexao?.qrcode?.base64 ?? null;
    const codigo = conexao?.code ?? conexao?.qrcode?.code ?? null;

    if (!base64 && !codigo) {
      return res.status(502).json({
        erro: 'A Evolution não devolveu QR Code. Tente "Preparar conexão" novamente.',
      });
    }

    // Normaliza para data URI, que é o que a tag <img> espera.
    const imagem = base64
      ? base64.startsWith('data:')
        ? base64
        : `data:image/png;base64,${base64}`
      : null;

    return res.json({ conectado: false, qrcode: imagem, codigo });
  } catch (erro) {
    logger.error('[whatsapp] falha ao gerar QR Code:', erro);
    return res.status(502).json({ erro: erro.message });
  }
});
