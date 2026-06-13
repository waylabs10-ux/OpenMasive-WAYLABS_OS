"use strict";

/**
 * Envoltura sobre @open-wa/wa-automate.
 *
 * Expone una API estable para el resto del servidor y soporta un MODO SIMULADO
 * (`WA_MOCK=true`) que reproduce el flujo completo (QR, conexión, envío,
 * bloqueos) sin abrir un navegador ni requerir un número real. Esto permite
 * desarrollar y probar la app de extremo a extremo.
 *
 * Estados de sesión: disconnected | qr_ready | connecting | connected | blocked
 */

const { registerBlockedNumber } = require("./store");

function canRequireOpenWa() {
  try {
    require.resolve("@open-wa/wa-automate");
    return true;
  } catch {
    return false;
  }
}

// Intención del usuario (variable de entorno) vs. capacidad real (OpenWA instalado).
const WANT_MOCK = (process.env.WA_MOCK ?? "true").toLowerCase() === "true";
const HAS_OPENWA = canRequireOpenWa();

// Solo se usa OpenWA real cuando el usuario lo pide (WA_MOCK=false) Y está instalado.
const IS_MOCK = WANT_MOCK || !HAS_OPENWA;

// Diagnóstico claro al arrancar: explica POR QUÉ se está en cada modo.
if (WANT_MOCK) {
  console.log("[wa] Modo SIMULADO activo (WA_MOCK=true).");
} else if (!HAS_OPENWA) {
  console.warn(
    "[wa] ⚠️  WA_MOCK=false pero '@open-wa/wa-automate' NO está instalado: " +
      "se usará el modo SIMULADO como respaldo.\n" +
      "      Instálalo con:  npm install --workspace wa-server @open-wa/wa-automate"
  );
} else {
  console.log("[wa] Modo REAL activo (OpenWA). Escanea el QR para conectar.");
}

// ─────────────────────────── Estado del módulo ────────────────────────────

const state = {
  status: "disconnected",
  qr: null, // data URL o string del QR
  phoneNumber: null, // número WA conectado (sin +)
  lastError: null,
  startedAt: null,
  reconnectAttempts: 0,
};

let waClient = null; // instancia real de OpenWA (si aplica)
let mockTimers = [];

const MAX_RECONNECT = 3;

function getState() {
  return {
    status: state.status,
    qr: state.qr,
    phoneNumber: state.phoneNumber,
    lastError: state.lastError,
    mock: IS_MOCK,
    startedAt: state.startedAt,
  };
}

// ────────────────────────────── Modo simulado ──────────────────────────────

/**
 * Genera un QR ficticio (string) y simula el avance del estado:
 * qr_ready → connecting → connected, tras lo cual asigna un número de prueba.
 */
function startMock() {
  resetMock();
  state.status = "qr_ready";
  state.startedAt = new Date().toISOString();
  // QR simulado: una cadena con timestamp para que `qrcode.react` la renderice.
  state.qr = `WA-MOCK-SESSION:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2)}`;
  state.lastError = null;

  // Tras 5s simula que el usuario escaneó el QR.
  mockTimers.push(
    setTimeout(() => {
      state.status = "connecting";
      state.qr = null;
    }, 5000)
  );

  // Tras 7s queda conectado con un número de demostración.
  mockTimers.push(
    setTimeout(() => {
      state.status = "connected";
      state.phoneNumber = process.env.WA_MOCK_NUMBER || "573001234567";
      state.reconnectAttempts = 0;
    }, 7000)
  );

  return getState();
}

function resetMock() {
  mockTimers.forEach(clearTimeout);
  mockTimers = [];
}

/**
 * En modo simulado decide aleatoriamente si un envío "falla" o "bloquea".
 * Probabilidad muy baja de bloqueo para no interrumpir las demos.
 */
function mockSendResult() {
  const roll = Math.random();
  if (roll < 0.01) return { ok: false, blocked: true };
  if (roll < 0.04) return { ok: false, blocked: false };
  return { ok: true, blocked: false };
}

// ──────────────────────────────── OpenWA real ──────────────────────────────

async function startReal() {
  const { create, ev } = require("@open-wa/wa-automate");

  state.status = "connecting";
  state.startedAt = new Date().toISOString();
  state.lastError = null;

  // Suscripción al QR antes de crear el cliente.
  ev.on("qr.**", (qrcode) => {
    state.qr = qrcode;
    state.status = "qr_ready";
  });

  // Ruta a un Chrome/Chromium del sistema (recomendado en Linux/servidores).
  const executablePath =
    process.env.WA_CHROME_PATH ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    undefined;

  // Argumentos imprescindibles para que Chromium arranque en Linux/contenedores
  // (el sandbox suele provocar el "Waiting failed: 30000ms exceeded").
  const browserArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
  ];

  waClient = await create({
    sessionId: process.env.WA_SESSION_ID || "wa-bulk-sender",
    multiDevice: true,
    // 0 = sin límite de tiempo para autenticarse / escanear el QR.
    authTimeout: Number(process.env.WA_AUTH_TIMEOUT) || 0,
    blockCrashLogs: true,
    disableSpins: true,
    headless: (process.env.WA_HEADLESS ?? "true").toLowerCase() !== "false",
    logConsole: false,
    qrTimeout: 0,
    // Usa el Chrome estable del sistema en lugar del Chromium empaquetado.
    useChrome: (process.env.WA_USE_CHROME ?? "true").toLowerCase() !== "false",
    executablePath,
    browserArgs,
    chromiumArgs: browserArgs,
    killProcessOnBrowserClose: true,
    cacheEnabled: false,
    // Espera más tiempo a que cargue WhatsApp Web en equipos/redes lentas.
    waitForRipeDatabase: false,
    licenseKey: process.env.OPENWA_LICENSE_KEY || undefined,
    qrCallback: (qr) => {
      state.qr = qr;
      state.status = "qr_ready";
    },
    onLoadingScreen: () => {
      state.status = "connecting";
    },
  });

  state.status = "connected";
  state.qr = null;

  try {
    const me = await waClient.getMe();
    state.phoneNumber =
      (me && (me.wid?.user || me.id?.user || me.me?.user)) || null;
  } catch {
    state.phoneNumber = null;
  }

  // Detección de bloqueo / conflicto de sesión.
  waClient.onStateChanged(async (s) => {
    if (s === "CONFLICT" || s === "UNLAUNCHED" || s === "UNPAIRED") {
      state.status = "blocked";
      if (state.phoneNumber) {
        registerBlockedNumber(state.phoneNumber, `state:${s}`);
      }
    }
    if (s === "CONNECTED") {
      state.status = "connected";
    }
  });

  return getState();
}

// ───────────────────────────── API pública ────────────────────────────────

/** Inicia la sesión de WhatsApp (real o simulada). */
async function start() {
  if (state.status === "connecting" || state.status === "qr_ready") {
    return getState();
  }
  if (IS_MOCK) {
    return startMock();
  }
  try {
    return await startReal();
  } catch (err) {
    state.status = "disconnected";
    state.lastError = err.message;
    console.error("[wa] Error iniciando OpenWA:", err.message);
    return getState();
  }
}

/** Cierra la sesión actual y limpia el estado. */
async function disconnect() {
  resetMock();
  if (waClient && typeof waClient.kill === "function") {
    try {
      await waClient.kill();
    } catch (err) {
      console.error("[wa] Error cerrando sesión:", err.message);
    }
  }
  waClient = null;
  state.status = "disconnected";
  state.qr = null;
  state.phoneNumber = null;
  return getState();
}

/**
 * Reintenta reconexión hasta MAX_RECONNECT veces (regla de negocio 7).
 */
async function tryReconnect() {
  if (state.reconnectAttempts >= MAX_RECONNECT) {
    state.status = "disconnected";
    return false;
  }
  state.reconnectAttempts += 1;
  await start();
  return state.status === "connected" || state.status === "qr_ready";
}

/** Simula el indicador "escribiendo..." durante `ms` milisegundos. */
async function simulateTyping(chatId, ms) {
  if (IS_MOCK || !waClient) {
    await new Promise((r) => setTimeout(r, ms));
    return;
  }
  try {
    await waClient.simulateTyping(chatId, true);
    await new Promise((r) => setTimeout(r, ms));
    await waClient.simulateTyping(chatId, false);
  } catch {
    /* no-op */
  }
}

/** Marca el chat como visto (doble check azul humano). */
async function sendSeen(chatId) {
  if (IS_MOCK || !waClient) return;
  try {
    await waClient.sendSeen(chatId);
  } catch {
    /* no-op */
  }
}

/**
 * Envía un mensaje de texto a un número.
 * @returns {Promise<{ok:boolean, blocked:boolean, messageId?:string, error?:string}>}
 */
async function sendText(phone, text) {
  if (state.status === "blocked") {
    return { ok: false, blocked: true, error: "Número bloqueado" };
  }

  if (IS_MOCK) {
    const result = mockSendResult();
    if (result.blocked) {
      state.status = "blocked";
      if (state.phoneNumber) {
        registerBlockedNumber(state.phoneNumber, "mock:block-detected");
      }
      return { ok: false, blocked: true, error: "Bloqueo simulado" };
    }
    if (!result.ok) {
      return { ok: false, blocked: false, error: "Fallo simulado de red" };
    }
    return {
      ok: true,
      blocked: false,
      messageId: `mock_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    };
  }

  if (!waClient) {
    return { ok: false, blocked: false, error: "Cliente WA no inicializado" };
  }

  const chatId = `${phone}@c.us`;
  try {
    const messageId = await waClient.sendText(chatId, text);
    // OpenWA devuelve un string id o un objeto de error.
    if (typeof messageId === "string" && messageId.length > 0) {
      return { ok: true, blocked: false, messageId };
    }
    return { ok: false, blocked: false, error: "Respuesta inesperada de WA" };
  } catch (err) {
    const message = (err && err.message) || String(err);
    const looksBlocked = /block|banned|forbidden|spam/i.test(message);
    if (looksBlocked && state.phoneNumber) {
      state.status = "blocked";
      registerBlockedNumber(state.phoneNumber, `error:${message}`);
    }
    return { ok: false, blocked: looksBlocked, error: message };
  }
}

module.exports = {
  IS_MOCK,
  getState,
  start,
  disconnect,
  tryReconnect,
  simulateTyping,
  sendSeen,
  sendText,
  getChatId: (phone) => `${phone}@c.us`,
};
