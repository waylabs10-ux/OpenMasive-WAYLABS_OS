"use strict";

/**
 * Capa de persistencia basada en archivos JSON.
 *
 * Toda la información crítica (registro de envíos y números bloqueados) se
 * guarda en disco para que la aplicación sobreviva a reinicios. Las escrituras
 * son atómicas (se escribe a un archivo temporal y luego se renombra) para
 * evitar corrupción si el proceso muere a mitad de una escritura.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const SENT_LOG_PATH = path.join(DATA_DIR, "sent-log.json");
const BLOCKED_PATH = path.join(DATA_DIR, "blocked-numbers.json");

function ensureFile(filePath, fallback) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf-8");
  }
}

function readJson(filePath, fallback) {
  try {
    ensureFile(filePath, fallback);
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw || "null") ?? fallback;
  } catch (err) {
    console.error(`[store] Error leyendo ${filePath}:`, err.message);
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureFile(filePath, Array.isArray(data) ? [] : {});
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

// ─────────────────────────── Registro de envíos ───────────────────────────

/** @returns {Array<{phone:string,messageId:string,sentAt:string,sentByNumber:string,waMessageId?:string}>} */
function getSentLog() {
  return readJson(SENT_LOG_PATH, []);
}

/**
 * Comprueba si un contacto ya recibió un mensaje específico.
 * Regla de negocio 1: nunca enviar el mismo phone + messageId dos veces.
 */
function hasBeenSent(phone, messageId) {
  return getSentLog().some(
    (r) => r.phone === phone && r.messageId === messageId
  );
}

/** Agrega un registro de envío confirmado. */
function appendSentRecord(record) {
  const log = getSentLog();
  log.push({
    phone: record.phone,
    messageId: record.messageId,
    sentAt: record.sentAt ?? new Date().toISOString(),
    sentByNumber: record.sentByNumber ?? "unknown",
    waMessageId: record.waMessageId ?? null,
  });
  writeJsonAtomic(SENT_LOG_PATH, log);
  return log;
}

/** Devuelve todos los teléfonos contactados por un número WA dado. */
function getContactsReachedBy(waNumber) {
  return Array.from(
    new Set(
      getSentLog()
        .filter((r) => r.sentByNumber === waNumber)
        .map((r) => r.phone)
    )
  );
}

// ───────────────────────── Números bloqueados ─────────────────────────────

/**
 * @returns {Array<{number:string,blockedAt:string,messagesSent:number,
 *                   contactsReached:string[],excludedManually?:boolean,reason?:string}>}
 */
function getBlockedNumbers() {
  return readJson(BLOCKED_PATH, []);
}

function isNumberBlocked(waNumber) {
  return getBlockedNumbers().some((b) => b.number === waNumber);
}

/**
 * Registra un número como bloqueado, guardando el historial de contactos que
 * alcanzó a contactar. Idempotente: si ya existe, actualiza sus datos.
 */
function registerBlockedNumber(waNumber, reason = "auto-detected") {
  const blocked = getBlockedNumbers();
  const contactsReached = getContactsReachedBy(waNumber);
  const existing = blocked.find((b) => b.number === waNumber);

  if (existing) {
    existing.contactsReached = contactsReached;
    existing.messagesSent = contactsReached.length;
    existing.reason = reason;
  } else {
    blocked.push({
      number: waNumber,
      blockedAt: new Date().toISOString(),
      messagesSent: contactsReached.length,
      contactsReached,
      reason,
      excludedManually: false,
    });
  }
  writeJsonAtomic(BLOCKED_PATH, blocked);
  return blocked;
}

/** Marca/desmarca un número para excluirlo manualmente de campañas futuras. */
function setManualExclusion(waNumber, excluded = true) {
  const blocked = getBlockedNumbers();
  let entry = blocked.find((b) => b.number === waNumber);
  if (!entry) {
    entry = {
      number: waNumber,
      blockedAt: new Date().toISOString(),
      messagesSent: getContactsReachedBy(waNumber).length,
      contactsReached: getContactsReachedBy(waNumber),
      reason: "manual-exclusion",
      excludedManually: excluded,
    };
    blocked.push(entry);
  } else {
    entry.excludedManually = excluded;
  }
  writeJsonAtomic(BLOCKED_PATH, blocked);
  return blocked;
}

/**
 * Conjunto de teléfonos "protegidos": contactos alcanzados por CUALQUIER número
 * bloqueado. Regla de negocio 3: nunca enviar a estos contactos desde un número
 * nuevo.
 */
function getProtectedContacts() {
  const protectedSet = new Set();
  for (const b of getBlockedNumbers()) {
    for (const phone of b.contactsReached || []) {
      protectedSet.add(phone);
    }
  }
  return protectedSet;
}

module.exports = {
  SENT_LOG_PATH,
  BLOCKED_PATH,
  getSentLog,
  hasBeenSent,
  appendSentRecord,
  getContactsReachedBy,
  getBlockedNumbers,
  isNumberBlocked,
  registerBlockedNumber,
  setManualExclusion,
  getProtectedContacts,
};
