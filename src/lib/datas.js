// ============================================================================
// src/lib/datas.js
// Utilidades de data no fuso da casa (America/Cuiaba por padrão).
//
// O servidor pode rodar em UTC no Railway, então nada aqui usa `new Date()`
// direto para descobrir "que dia é hoje" — sempre passa pelo fuso configurado,
// senão depois das 20h em Cuiabá o bot já acharia que é o dia seguinte.
// ============================================================================

import { env } from '../config/env.js';

const DIAS_SEMANA = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

/** Data de hoje no fuso da casa, no formato YYYY-MM-DD. */
export function hojeISO(agora = new Date()) {
  // 'en-CA' formata como YYYY-MM-DD, que é exatamente o formato do Postgres.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

/** Hora atual no fuso da casa, no formato HH:MM. */
export function agoraHHMM(agora = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: env.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(agora);
}

/** Nome do dia da semana de uma data YYYY-MM-DD. */
export function diaDaSemana(dataISO) {
  // O 'T12:00:00Z' evita que o deslocamento de fuso jogue a data para o dia
  // anterior — meio-dia UTC é seguro para qualquer fuso do Brasil.
  const data = new Date(`${dataISO}T12:00:00Z`);
  if (Number.isNaN(data.getTime())) return '';
  return DIAS_SEMANA[data.getUTCDay()];
}

/** Valida o formato YYYY-MM-DD e se a data existe de verdade. */
export function dataValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor ?? '')) return false;
  const data = new Date(`${valor}T12:00:00Z`);
  if (Number.isNaN(data.getTime())) return false;
  // Rejeita coisas como 2026-02-31, que o Date "conserta" silenciosamente.
  return hojeISO(data) === valor || data.toISOString().slice(0, 10) === valor;
}

/** Normaliza "20h", "20:00", "8:30" para HH:MM. Devolve null se não der. */
export function normalizarHorario(valor) {
  if (!valor) return null;
  const texto = String(valor).trim().toLowerCase();

  const comMinutos = texto.match(/^(\d{1,2})[:h](\d{2})/);
  if (comMinutos) {
    const hora = Number(comMinutos[1]);
    const minuto = Number(comMinutos[2]);
    if (hora > 23 || minuto > 59) return null;
    return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
  }

  const soHora = texto.match(/^(\d{1,2})h?$/);
  if (soHora) {
    const hora = Number(soHora[1]);
    if (hora > 23) return null;
    return `${String(hora).padStart(2, '0')}:00`;
  }

  return null;
}

/** Diferença em dias entre duas datas YYYY-MM-DD (b - a). */
export function diferencaEmDias(dataA, dataB) {
  const a = new Date(`${dataA}T12:00:00Z`).getTime();
  const b = new Date(`${dataB}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/** Formata YYYY-MM-DD como DD/MM/YYYY para falar com o cliente. */
export function formatarBR(dataISO) {
  if (!dataISO) return '';
  return dataISO.split('-').reverse().join('/');
}
