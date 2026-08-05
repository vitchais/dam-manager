// Testes do que o webhook faz com os payloads da Evolution API.
// Rodar: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extrairMensagem } from '../src/routes/webhook.js';
import { normalizarNumero } from '../src/lib/evolution.js';

/** Monta um payload no formato que a Evolution manda em MESSAGES_UPSERT. */
function payload({ fromMe = false, remoteJid = '5565999998888@s.whatsapp.net', message, id = 'ABC123' }) {
  return {
    event: 'messages.upsert',
    instance: 'dam',
    data: { key: { remoteJid, fromMe, id }, message, pushName: 'Cliente' },
  };
}

test('extrai texto de uma mensagem simples', () => {
  const resultado = extrairMensagem(
    payload({ message: { conversation: 'quero reservar pra sexta' } }),
  );

  assert.equal(resultado.telefone, '5565999998888');
  assert.equal(resultado.texto, 'quero reservar pra sexta');
  assert.equal(resultado.waId, 'ABC123');
  assert.equal(resultado.semTexto, false);
});

test('extrai texto de extendedTextMessage (resposta citando outra)', () => {
  const resultado = extrairMensagem(
    payload({ message: { extendedTextMessage: { text: 'pode ser 20h' } } }),
  );
  assert.equal(resultado.texto, 'pode ser 20h');
});

test('ignora mensagem enviada pelo próprio bot', () => {
  const resultado = extrairMensagem(
    payload({ fromMe: true, message: { conversation: 'resposta do bot' } }),
  );
  assert.equal(resultado, null, 'responder a si mesmo criaria um laço infinito');
});

test('ignora mensagem de grupo', () => {
  const resultado = extrairMensagem(
    payload({ remoteJid: '120363000000@g.us', message: { conversation: 'oi' } }),
  );
  assert.equal(resultado, null);
});

test('ignora status/broadcast', () => {
  const resultado = extrairMensagem(
    payload({ remoteJid: 'status@broadcast', message: { conversation: 'oi' } }),
  );
  assert.equal(resultado, null);
});

test('marca mídia sem legenda como semTexto', () => {
  const resultado = extrairMensagem(
    payload({ message: { audioMessage: { seconds: 3 } } }),
  );
  assert.equal(resultado.semTexto, true);
  assert.equal(resultado.telefone, '5565999998888');
});

test('aceita legenda de imagem como texto', () => {
  const resultado = extrairMensagem(
    payload({ message: { imageMessage: { caption: 'é esse aqui?' } } }),
  );
  assert.equal(resultado.texto, 'é esse aqui?');
  assert.equal(resultado.semTexto, false);
});

test('lida com payload em array', () => {
  const bruto = payload({ message: { conversation: 'oi' } });
  bruto.data = [bruto.data];
  assert.equal(extrairMensagem(bruto).texto, 'oi');
});

test('não quebra com payload vazio', () => {
  assert.equal(extrairMensagem(null), null);
  assert.equal(extrairMensagem({}), null);
  assert.equal(extrairMensagem({ data: {} }), null);
});

test('normalizarNumero limpa JID e pontuação', () => {
  assert.equal(normalizarNumero('5565999998888@s.whatsapp.net'), '5565999998888');
  assert.equal(normalizarNumero('+55 (65) 99999-8888'), '5565999998888');
  assert.equal(normalizarNumero(''), '');
});
