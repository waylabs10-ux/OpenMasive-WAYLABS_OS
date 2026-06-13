"use strict";

/**
 * Configuración y utilidades de protección anti-bloqueo.
 *
 * El objetivo es imitar el comportamiento humano para reducir la probabilidad
 * de que WhatsApp bloquee el número: delays aleatorios, pausas por lotes,
 * límite diario y simulación de escritura.
 */

const ANTI_BLOCK_CONFIG = {
  minDelayMs: Number(process.env.WA_MIN_DELAY_MS) || 8000, // 8s mínimo
  maxDelayMs: Number(process.env.WA_MAX_DELAY_MS) || 25000, // 25s máximo
  batchSize: Number(process.env.WA_BATCH_SIZE) || 30, // pausa larga cada N
  batchPauseMs: Number(process.env.WA_BATCH_PAUSE_MS) || 300000, // 5 min
  randomizeDelay: true,
  maxDailyMessages: Number(process.env.WA_MAX_DAILY_MESSAGES) || 150,
  typingSimulation:
    (process.env.WA_TYPING_SIMULATION ?? "true").toLowerCase() !== "false",
  typingDurationMs: [1500, 4000], // duración aleatoria "escribiendo..."
};

/** Entero aleatorio inclusivo en [min, max]. */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calcula el delay (ms) a esperar antes del siguiente mensaje.
 * Si `randomizeDelay` está activo, el valor es aleatorio dentro del rango
 * configurado para evitar intervalos fijos y robóticos.
 */
function nextDelay(config = ANTI_BLOCK_CONFIG) {
  if (!config.randomizeDelay) {
    return config.minDelayMs;
  }
  const min = Math.min(config.minDelayMs, config.maxDelayMs);
  const max = Math.max(config.minDelayMs, config.maxDelayMs);
  return randomBetween(min, max);
}

/** Duración aleatoria para la simulación de "escribiendo...". */
function typingDuration(config = ANTI_BLOCK_CONFIG) {
  const [min, max] = config.typingDurationMs;
  return randomBetween(min, max);
}

/** ¿Toca pausa larga de lote después de `count` mensajes? */
function shouldBatchPause(count, config = ANTI_BLOCK_CONFIG) {
  return count > 0 && count % config.batchSize === 0;
}

/** ¿Se alcanzó el límite diario de mensajes para este número? */
function reachedDailyLimit(sentToday, config = ANTI_BLOCK_CONFIG) {
  return sentToday >= config.maxDailyMessages;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  ANTI_BLOCK_CONFIG,
  randomBetween,
  nextDelay,
  typingDuration,
  shouldBatchPause,
  reachedDailyLimit,
  sleep,
};
