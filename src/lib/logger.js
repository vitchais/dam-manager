// ============================================================================
// src/lib/logger.js
// Log simples com timestamp. Sem dependência externa de propósito: o Railway
// já agrega stdout/stderr, então basta escrever linhas legíveis.
// ============================================================================

function carimbo() {
  return new Date().toISOString();
}

function escrever(nivel, destino, args) {
  destino(`${carimbo()} [${nivel}]`, ...args);
}

export const logger = {
  info: (...args) => escrever('info', console.log, args),
  warn: (...args) => escrever('warn', console.warn, args),
  error: (...args) => escrever('error', console.error, args),
  debug: (...args) => {
    if (process.env.LOG_LEVEL === 'debug') escrever('debug', console.log, args);
  },
};
