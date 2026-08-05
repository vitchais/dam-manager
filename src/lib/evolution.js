// ============================================================================
// src/lib/evolution.js
//
// Cliente HTTP da Evolution API v2 (a ponte com o WhatsApp).
//
// Todas as rotas são autenticadas pelo header `apikey`, cujo valor é o
// AUTHENTICATION_API_KEY configurado no serviço da Evolution API no Railway.
//
// Rotas da v2 usadas aqui:
//   POST /instance/create               cria a instância (a "linha" de WhatsApp)
//   GET  /instance/connect/{instance}   devolve o QR Code para parear o celular
//   GET  /instance/connectionState/{i}  diz se o número está conectado
//   POST /webhook/set/{instance}        aponta os eventos para o nosso servidor
//   POST /message/sendText/{instance}   envia mensagem de texto
//   POST /chat/sendPresence/{instance}  mostra "digitando..." para o cliente
// ============================================================================

import { env, features } from '../config/env.js';
import { logger } from './logger.js';

const TIMEOUT_MS = 20000;

function garantirConfigurado() {
  if (!features.evolution) {
    throw new Error(
      'Evolution API não configurada: defina EVOLUTION_API_URL e EVOLUTION_API_KEY.',
    );
  }
}

async function chamar(metodo, caminho, corpo) {
  garantirConfigurado();

  const alvo = `${env.evolution.apiUrl}${caminho}`;
  // AbortSignal.timeout evita que uma Evolution fora do ar trave o webhook.
  const resposta = await fetch(alvo, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      apikey: env.evolution.apiKey,
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = { raw: texto };
  }

  if (!resposta.ok) {
    const detalhe = dados?.response?.message ?? dados?.message ?? texto;
    throw new Error(
      `Evolution API ${metodo} ${caminho} falhou (${resposta.status}): ${detalhe}`,
    );
  }

  return dados;
}

/**
 * Converte um telefone em JID do WhatsApp.
 * A Evolution aceita só os dígitos no campo `number`, então normalizamos.
 */
export function normalizarNumero(valor) {
  if (!valor) return '';
  // "5565993378770@s.whatsapp.net" → "5565993378770"
  return String(valor).split('@')[0].replace(/\D/g, '');
}

/** Cria a instância. Se ela já existir, a Evolution devolve erro 403 — tratado. */
export async function criarInstancia(nome = env.evolution.instance) {
  return chamar('POST', '/instance/create', {
    instanceName: nome,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
  });
}

/** Devolve o QR Code (base64) para parear o celular. */
export async function conectarInstancia(nome = env.evolution.instance) {
  return chamar('GET', `/instance/connect/${encodeURIComponent(nome)}`);
}

/** Estado da conexão: 'open' (conectado), 'connecting', 'close'. */
export async function estadoInstancia(nome = env.evolution.instance) {
  return chamar('GET', `/instance/connectionState/${encodeURIComponent(nome)}`);
}

/**
 * Aponta o webhook da instância para o nosso servidor.
 * O token vai na querystring porque a Evolution não permite header custom.
 */
export async function definirWebhook({
  nome = env.evolution.instance,
  urlDestino,
} = {}) {
  const destino =
    urlDestino ?? `${env.appUrl}/webhook/evolution?token=${env.evolution.webhookToken}`;

  return chamar('POST', `/webhook/set/${encodeURIComponent(nome)}`, {
    webhook: {
      enabled: true,
      url: destino,
      // Um único endpoint recebe todos os eventos (não abrir uma rota por evento).
      byEvents: false,
      base64: false,
      // Só o que interessa: mensagens novas e mudança de conexão.
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
    },
  });
}

/** Envia uma mensagem de texto. */
export async function enviarTexto({
  numero,
  texto,
  nome = env.evolution.instance,
  delayMs = 0,
}) {
  const destino = normalizarNumero(numero);
  if (!destino) throw new Error('enviarTexto: número de destino vazio.');
  if (!texto?.trim()) throw new Error('enviarTexto: texto vazio.');

  return chamar('POST', `/message/sendText/${encodeURIComponent(nome)}`, {
    number: destino,
    text: texto,
    delay: delayMs,
  });
}

/**
 * Mostra "digitando..." — puramente cosmético, então falhas são engolidas:
 * não faz sentido perder a resposta do bot porque a presença não subiu.
 */
export async function mostrarDigitando({
  numero,
  nome = env.evolution.instance,
  duracaoMs = 2000,
}) {
  try {
    await chamar('POST', `/chat/sendPresence/${encodeURIComponent(nome)}`, {
      number: normalizarNumero(numero),
      presence: 'composing',
      delay: duracaoMs,
    });
  } catch (erro) {
    logger.debug('[evolution] presença falhou (ignorado):', erro.message);
  }
}
