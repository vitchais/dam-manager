// ============================================================================
// src/routes/webhook.js
//
// Recebe os eventos da Evolution API.
//
// Dois cuidados que valem destacar:
//
// 1. Responder 200 IMEDIATAMENTE. A Evolution tem timeout curto e refaz a
//    entrega se demorarmos. Como uma resposta do modelo leva alguns segundos,
//    processamos depois de responder — senão o mesmo cliente receberia a
//    resposta duplicada.
//
// 2. Agrupar mensagens (debounce). No WhatsApp é normal o cliente mandar
//    "oi" / "queria reservar" / "pra sexta" em três balões. Sem agrupar, o bot
//    responderia três vezes, cada uma com contexto pela metade.
// ============================================================================

import express from 'express';
import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { enviarTexto, mostrarDigitando, normalizarNumero } from '../lib/evolution.js';
import { responder } from '../services/chatbot.js';

export const webhookRouter = express.Router();

// telefone → { textos: [], temporizador } enquanto esperamos o cliente terminar.
const pendentes = new Map();

/** Confere o token que colocamos na URL do webhook. */
function tokenValido(req) {
  const informado =
    req.query.token ?? req.get('x-webhook-token') ?? req.body?.token ?? '';
  const esperado = env.evolution.webhookToken;
  if (!esperado) return false;
  return String(informado) === esperado;
}

/**
 * Extrai o que interessa do payload MESSAGES_UPSERT.
 * Devolve null quando é uma mensagem que o bot deve ignorar.
 */
export function extrairMensagem(payload) {
  const dados = payload?.data ?? payload;
  if (!dados) return null;

  // A Evolution às vezes manda um array de mensagens.
  const item = Array.isArray(dados) ? dados[0] : dados;
  const chave = item?.key;
  if (!chave) return null;

  // Mensagem enviada pelo próprio número conectado — senão o bot responderia
  // às próprias respostas, em loop.
  if (chave.fromMe) return null;

  const remoteJid = chave.remoteJid ?? '';

  // Grupos (@g.us) e status/broadcast não entram no atendimento.
  if (remoteJid.includes('@g.us')) return null;
  if (remoteJid.includes('broadcast')) return null;
  if (!remoteJid.includes('@s.whatsapp.net')) return null;

  const conteudo = item.message ?? {};
  const texto =
    conteudo.conversation ??
    conteudo.extendedTextMessage?.text ??
    conteudo.imageMessage?.caption ??
    conteudo.videoMessage?.caption ??
    conteudo.buttonsResponseMessage?.selectedDisplayText ??
    conteudo.listResponseMessage?.title ??
    null;

  if (!texto || !String(texto).trim()) {
    // Áudio, figurinha, localização… nada de texto para o modelo ler.
    return {
      telefone: normalizarNumero(remoteJid),
      texto: null,
      waId: chave.id ?? null,
      semTexto: true,
    };
  }

  return {
    telefone: normalizarNumero(remoteJid),
    texto: String(texto).trim(),
    waId: chave.id ?? null,
    nomeWhatsApp: item.pushName ?? null,
    semTexto: false,
  };
}

/** Junta os balões recebidos e responde uma vez só. */
function agendarResposta({ telefone, texto, waId }) {
  const atual = pendentes.get(telefone) ?? { textos: [], temporizador: null, waId: null };

  atual.textos.push(texto);
  atual.waId = atual.waId ?? waId; // guarda o id do 1º balão, para dedupe

  if (atual.temporizador) clearTimeout(atual.temporizador);

  atual.temporizador = setTimeout(() => {
    pendentes.delete(telefone);
    processar({
      telefone,
      texto: atual.textos.join('\n'),
      waId: atual.waId,
    }).catch((erro) => {
      logger.error('[webhook] falha ao processar mensagem:', erro);
    });
  }, Math.max(env.chatbot.debounceSeconds, 0) * 1000);

  pendentes.set(telefone, atual);
}

async function processar({ telefone, texto, waId }) {
  if (env.chatbot.ignoreNumbers.includes(telefone)) {
    logger.info(`[webhook] ${telefone} está na lista de ignorados.`);
    return;
  }

  logger.info(`[webhook] processando mensagem de ${telefone}`);

  await mostrarDigitando({ numero: telefone });

  const resposta = await responder({ telefone, texto, waId });
  if (!resposta) return;

  await enviarTexto({ numero: telefone, texto: resposta });
  logger.info(`[webhook] resposta enviada para ${telefone}`);
}

webhookRouter.post('/evolution', (req, res) => {
  if (!tokenValido(req)) {
    logger.warn('[webhook] requisição rejeitada: token inválido ou ausente.');
    return res.status(401).json({ erro: 'token inválido' });
  }

  // Confirma o recebimento antes de trabalhar (ver comentário do topo).
  res.status(200).json({ recebido: true });

  if (!features.chatbot) {
    logger.warn('[webhook] chatbot desligado — evento descartado.');
    return undefined;
  }

  const evento = req.body?.event ?? '';

  if (evento === 'connection.update' || evento === 'CONNECTION_UPDATE') {
    const estado = req.body?.data?.state ?? req.body?.data?.connection;
    logger.info(`[webhook] conexão do WhatsApp: ${estado}`);
    return undefined;
  }

  if (evento !== 'messages.upsert' && evento !== 'MESSAGES_UPSERT') {
    logger.debug(`[webhook] evento ignorado: ${evento}`);
    return undefined;
  }

  let mensagem;
  try {
    mensagem = extrairMensagem(req.body);
  } catch (erro) {
    logger.error('[webhook] payload inesperado:', erro);
    return undefined;
  }

  if (!mensagem?.telefone) return undefined;

  // Mídia sem legenda: avisa que só lemos texto, em vez de ficar mudo.
  if (mensagem.semTexto) {
    enviarTexto({
      numero: mensagem.telefone,
      texto:
        'Oi! Por aqui eu consigo ler só mensagens de texto. Pode me escrever o que você precisa? 🙂',
    }).catch((erro) => logger.error('[webhook] falha ao responder mídia:', erro));
    return undefined;
  }

  agendarResposta(mensagem);
  return undefined;
});

// GET no mesmo caminho ajuda a testar se a URL está de pé pelo navegador.
webhookRouter.get('/evolution', (req, res) => {
  res.json({
    ok: true,
    mensagem: 'Endpoint do webhook ativo. A Evolution API deve usar POST aqui.',
    chatbotAtivo: features.chatbot,
  });
});
