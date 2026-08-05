// Testes das regras de reserva e dos utilitários de data.
// Estes testes não tocam no banco: validarPedido é pura.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validarPedido, ErroDeReserva } from '../src/services/reservas.js';
import {
  normalizarHorario,
  formatarBR,
  diferencaEmDias,
  hojeISO,
} from '../src/lib/datas.js';

/** Uma data segura no futuro, para não depender do dia em que o teste roda. */
function daquiADias(dias) {
  const base = new Date(`${hojeISO()}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

test('normalizarHorario aceita os formatos que o cliente digita', () => {
  assert.equal(normalizarHorario('20:00'), '20:00');
  assert.equal(normalizarHorario('20h'), '20:00');
  assert.equal(normalizarHorario('20'), '20:00');
  assert.equal(normalizarHorario('8:30'), '08:30');
  assert.equal(normalizarHorario('20h30'), '20:30');
  assert.equal(normalizarHorario('25:00'), null);
  assert.equal(normalizarHorario('qualquer coisa'), null);
  assert.equal(normalizarHorario(''), null);
});

test('formatarBR converte ISO para o formato brasileiro', () => {
  assert.equal(formatarBR('2026-08-14'), '14/08/2026');
});

test('diferencaEmDias conta certo', () => {
  assert.equal(diferencaEmDias('2026-08-01', '2026-08-08'), 7);
  assert.equal(diferencaEmDias('2026-08-08', '2026-08-01'), -7);
});

test('validarPedido aceita um pedido normal', () => {
  const pedido = validarPedido({
    data: daquiADias(7),
    horario: '20h',
    pessoas: 4,
  });
  assert.equal(pedido.horario, '20:00');
  assert.equal(pedido.pessoas, 4);
});

test('validarPedido rejeita data no passado', () => {
  assert.throws(
    () => validarPedido({ data: daquiADias(-1), horario: '20:00', pessoas: 2 }),
    ErroDeReserva,
  );
});

test('validarPedido rejeita data longe demais', () => {
  assert.throws(
    () => validarPedido({ data: daquiADias(400), horario: '20:00', pessoas: 2 }),
    ErroDeReserva,
  );
});

test('validarPedido rejeita formato de data errado', () => {
  assert.throws(
    () => validarPedido({ data: '14/08/2026', horario: '20:00', pessoas: 2 }),
    ErroDeReserva,
  );
});

test('validarPedido rejeita quantidade de pessoas inválida', () => {
  for (const pessoas of [0, -3, 'muitas', 1.5]) {
    assert.throws(
      () => validarPedido({ data: daquiADias(7), horario: '20:00', pessoas }),
      ErroDeReserva,
      `deveria rejeitar pessoas=${pessoas}`,
    );
  }
});

test('validarPedido rejeita grupo acima da capacidade da casa', () => {
  assert.throws(
    () => validarPedido({ data: daquiADias(7), horario: '20:00', pessoas: 5000 }),
    ErroDeReserva,
  );
});

test('validarPedido rejeita horário sem sentido', () => {
  assert.throws(
    () => validarPedido({ data: daquiADias(7), horario: 'de noite', pessoas: 2 }),
    ErroDeReserva,
  );
});
