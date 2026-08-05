// ============================================================================
// src/routes/health.js
//
// /health  → checagem rápida usada pelo Railway para saber se o deploy subiu.
//            Sempre 200 se o processo está vivo.
// /status  → diagnóstico legível: o que está configurado e o que falta.
//            Não expõe nenhum valor de credencial, só se existe ou não.
// ============================================================================

import express from 'express';
import { env, features, pendencias } from '../config/env.js';
import { estadoInstancia } from '../lib/evolution.js';

export const healthRouter = express.Router();

healthRouter.get('/health', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

healthRouter.get('/status', async (req, res) => {
  const faltando = pendencias().map((req_) => ({
    variaveis: req_.vars,
    porque: req_.porque,
    onde: req_.onde,
  }));

  let whatsapp = { conectado: false, detalhe: 'Evolution API não configurada.' };

  if (features.evolution) {
    try {
      const estado = await estadoInstancia();
      const situacao = estado?.instance?.state ?? estado?.state ?? 'desconhecido';
      whatsapp = {
        conectado: situacao === 'open',
        estado: situacao,
        instancia: env.evolution.instance,
        detalhe:
          situacao === 'open'
            ? 'Número conectado.'
            : 'Instância existe mas o número não está pareado. Leia o QR Code.',
      };
    } catch (erro) {
      whatsapp = { conectado: false, detalhe: erro.message };
    }
  }

  res.json({
    ambiente: env.nodeEnv,
    appUrl: env.appUrl,
    recursos: features,
    whatsapp,
    pendencias: faltando,
    pronto: faltando.length === 0 && whatsapp.conectado,
  });
});
