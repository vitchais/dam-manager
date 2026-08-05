// ============================================================================
// src/routes/api.js
//
// API do painel administrativo.
//
// O painel antigo falava direto com o Supabase usando a chave pública. Isso
// significava que qualquer pessoa que abrisse o código-fonte da página tinha
// acesso à base inteira de clientes (nome + telefone). Agora o navegador fala
// só com este servidor, que exige senha e usa a chave service_role internamente.
// ============================================================================

import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';
import {
  ErroDeReserva,
  listarReservas,
  atualizarStatus,
  excluirReserva,
  criarReserva,
} from '../services/reservas.js';
import { definirModo } from '../services/conversas.js';

export const apiRouter = express.Router();

/** Compara em tempo constante, para não vazar a senha por tempo de resposta. */
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
      erro: 'Painel indisponível: ADMIN_PASSWORD não foi configurada no servidor.',
    });
  }

  const informada = req.get('x-admin-password') ?? req.query.senha ?? '';

  if (!senhaConfere(informada)) {
    return res.status(401).json({ erro: 'Senha inválida.' });
  }

  return next();
}

function exigirSupabase(req, res, next) {
  if (!features.supabase) {
    return res.status(503).json({
      erro: 'Banco indisponível: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados.',
    });
  }
  return next();
}

/** Converte exceções em respostas HTTP sem vazar detalhe interno. */
function tratar(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (erro) {
      if (erro instanceof ErroDeReserva) {
        return res.status(400).json({ erro: erro.message });
      }
      logger.error('[api] erro não tratado:', erro);
      return res.status(500).json({ erro: 'Erro interno. Veja os logs do servidor.' });
    }
    return undefined;
  };
}

// Login: o painel chama uma vez e guarda a senha na sessão do navegador.
apiRouter.post('/login', exigirAdmin, (req, res) => {
  res.json({ ok: true });
});

apiRouter.get(
  '/reservas',
  exigirAdmin,
  exigirSupabase,
  tratar(async (req, res) => {
    const reservas = await listarReservas({
      de: req.query.de ?? null,
      ate: req.query.ate ?? null,
      status: req.query.status ?? null,
    });
    res.json({ reservas });
  }),
);

apiRouter.post(
  '/reservas',
  exigirAdmin,
  exigirSupabase,
  tratar(async (req, res) => {
    const reserva = await criarReserva({
      telefone: req.body.telefone,
      nome: req.body.nome,
      data: req.body.data,
      horario: req.body.horario,
      pessoas: req.body.pessoas,
      ambiente: req.body.ambiente ?? null,
      observacoes: req.body.observacoes ?? null,
      origem: 'painel',
    });
    res.status(201).json({ reserva });
  }),
);

apiRouter.patch(
  '/reservas/:id/status',
  exigirAdmin,
  exigirSupabase,
  tratar(async (req, res) => {
    const reserva = await atualizarStatus({
      reservaId: req.params.id,
      status: req.body.status,
    });
    res.json({ reserva });
  }),
);

apiRouter.delete(
  '/reservas/:id',
  exigirAdmin,
  exigirSupabase,
  tratar(async (req, res) => {
    await excluirReserva(req.params.id);
    res.json({ ok: true });
  }),
);

// Devolve a conversa para o bot depois que o atendente humano terminou.
apiRouter.post(
  '/conversas/:telefone/modo',
  exigirAdmin,
  exigirSupabase,
  tratar(async (req, res) => {
    const conversa = await definirModo({
      telefone: req.params.telefone,
      modo: req.body.modo === 'humano' ? 'humano' : 'bot',
    });
    res.json({ conversa });
  }),
);
