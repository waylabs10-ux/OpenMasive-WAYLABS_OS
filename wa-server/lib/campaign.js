"use strict";

/**
 * Motor de campaña de envío masivo.
 *
 * Procesa una cola de (contacto × mensaje) aplicando:
 *  - Deduplicación (sent-log.json): nunca repetir phone+messageId.
 *  - Protección: nunca enviar a contactos alcanzados por números bloqueados.
 *  - Rate limiting humanizado: delays aleatorios, pausas por lote, simulación
 *    de escritura, límite diario.
 *  - Detección de bloqueo: pausa automática y registro del número.
 *
 * Solo se permite UNA campaña activa a la vez.
 */

const wa = require("./wa");
const store = require("./store");
const {
  ANTI_BLOCK_CONFIG,
  nextDelay,
  typingDuration,
  shouldBatchPause,
  reachedDailyLimit,
  sleep,
} = require("../middleware/rateLimiter");

/** Selecciona el texto del mensaje para un contacto según el modo configurado. */
function pickMessage(messages, config, index) {
  if (!messages.length) return null;
  switch (config.messageSelection) {
    case "single": {
      const found = messages.find((m) => m.id === config.selectedMessageId);
      return found || messages[0];
    }
    case "sequential":
      return messages[index % messages.length];
    case "random":
    default:
      return messages[Math.floor(Math.random() * messages.length)];
  }
}

/** Reemplaza variables {campo} en la plantilla con datos del contacto. */
function renderTemplate(template, contact) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (contact[key] !== undefined && contact[key] !== null) {
      return String(contact[key]);
    }
    return match; // deja la variable intacta si no existe el campo
  });
}

class CampaignEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.id = null;
    this.status = "idle"; // idle | running | paused | completed | cancelled | blocked
    this.config = { ...ANTI_BLOCK_CONFIG };
    this.contacts = [];
    this.messages = [];
    this.queue = [];
    this.cursor = 0;
    this.counters = { total: 0, sent: 0, skipped: 0, failed: 0, protected: 0 };
    this.events = []; // log en vivo (máx 200)
    this.sentToday = 0;
    this.startedAt = null;
    this.finishedAt = null;
    this._pauseRequested = false;
    this._cancelRequested = false;
    this._runningPromise = null;
  }

  isActive() {
    return this.status === "running" || this.status === "paused";
  }

  log(type, payload = {}) {
    const entry = { ts: new Date().toISOString(), type, ...payload };
    this.events.unshift(entry);
    if (this.events.length > 200) this.events.length = 200;
  }

  /** ¿La dedup es por teléfono? (por defecto sí). */
  isPhoneDedup() {
    return (this.config.dedupeBy ?? "phone") !== "message";
  }

  /** Comprueba si un envío ya se hizo, según la estrategia de dedup. */
  alreadySent(phone, messageId) {
    return this.isPhoneDedup()
      ? store.hasBeenSentToPhone(phone)
      : store.hasBeenSent(phone, messageId);
  }

  /** Construye la cola aplicando dedup y protección antes de empezar. */
  buildQueue() {
    const protectedContacts = store.getProtectedContacts();
    const phoneDedup = this.isPhoneDedup();
    const seenInQueue = new Set();
    const queue = [];
    let index = 0;

    for (const contact of this.contacts) {
      const message = pickMessage(this.messages, this.config, index);
      index += 1;
      if (!message) continue;

      const item = {
        phone: contact.phone,
        contact,
        messageId: message.id,
        text: renderTemplate(message.text, contact),
      };

      // Clave de unicidad dentro de la propia cola (evita duplicados si el CSV
      // trae el mismo número repetido).
      const queueKey = phoneDedup
        ? contact.phone
        : `${contact.phone}::${message.id}`;

      if (protectedContacts.has(contact.phone)) {
        item.skipReason = "protected";
      } else if (this.alreadySent(contact.phone, message.id)) {
        item.skipReason = "duplicate";
      } else if (seenInQueue.has(queueKey)) {
        item.skipReason = "duplicate";
      } else {
        seenInQueue.add(queueKey);
      }
      queue.push(item);
    }
    return queue;
  }

  /** Inicia una nueva campaña. */
  start({ contacts, messages, config }) {
    if (this.isActive()) {
      throw new Error("Ya hay una campaña en curso");
    }
    this.reset();
    this.id = `camp_${Date.now()}`;
    this.contacts = contacts || [];
    this.messages = messages || [];
    this.config = { ...ANTI_BLOCK_CONFIG, ...(config || {}) };
    this.queue = this.buildQueue();
    this.counters.total = this.queue.length;
    this.status = "running";
    this.startedAt = new Date().toISOString();
    this.log("campaign_start", { total: this.counters.total });

    this._runningPromise = this._run();
    return this.getStatus();
  }

  pause() {
    if (this.status === "running") {
      this._pauseRequested = true;
      this.log("pause_requested");
    }
    return this.getStatus();
  }

  resume() {
    if (this.status === "paused") {
      this._pauseRequested = false;
      this.status = "running";
      this.log("resume");
      this._runningPromise = this._run();
    }
    return this.getStatus();
  }

  cancel() {
    if (this.isActive()) {
      this._cancelRequested = true;
      this.log("cancel_requested");
    }
    return this.getStatus();
  }

  async _run() {
    while (this.cursor < this.queue.length) {
      if (this._cancelRequested) {
        this.status = "cancelled";
        this.finishedAt = new Date().toISOString();
        this.log("campaign_cancelled");
        return;
      }
      if (this._pauseRequested) {
        this.status = "paused";
        this.log("campaign_paused");
        return;
      }

      // Si el número quedó bloqueado, detener todo (regla 2 y 3).
      const waState = wa.getState();
      if (waState.status === "blocked") {
        this.status = "blocked";
        this.finishedAt = new Date().toISOString();
        this.log("campaign_blocked", { number: waState.phoneNumber });
        return;
      }

      // Límite diario por número.
      if (reachedDailyLimit(this.sentToday, this.config)) {
        this.status = "paused";
        this.log("daily_limit_reached", { sentToday: this.sentToday });
        return;
      }

      const item = this.queue[this.cursor];

      // Dedup / protección: saltar sin enviar.
      if (item.skipReason) {
        this.counters.skipped += 1;
        if (item.skipReason === "protected") this.counters.protected += 1;
        this.log("skipped", {
          phone: item.phone,
          messageId: item.messageId,
          reason: item.skipReason,
        });
        this.cursor += 1;
        continue;
      }

      // Reverificar contra el log en disco (puede haber cambiado).
      if (this.alreadySent(item.phone, item.messageId)) {
        this.counters.skipped += 1;
        this.log("skipped", {
          phone: item.phone,
          messageId: item.messageId,
          reason: "duplicate",
        });
        this.cursor += 1;
        continue;
      }

      await this._sendItem(item);
      this.cursor += 1;

      // Pausa larga por lote.
      if (
        this.cursor < this.queue.length &&
        shouldBatchPause(this.counters.sent, this.config)
      ) {
        this.log("batch_pause", { ms: this.config.batchPauseMs });
        await this._interruptibleSleep(this.config.batchPauseMs);
      } else if (this.cursor < this.queue.length) {
        // Delay humanizado entre mensajes.
        const delay = nextDelay(this.config);
        this.log("waiting", { ms: delay });
        await this._interruptibleSleep(delay);
      }
    }

    // Fin natural de la cola.
    if (!this._cancelRequested && !this._pauseRequested) {
      this.status = "completed";
      this.finishedAt = new Date().toISOString();
      this.log("campaign_completed", { ...this.counters });
    }
  }

  async _sendItem(item) {
    const chatId = wa.getChatId(item.phone);

    // Humanización: ver chat + simular escritura.
    if (this.config.typingSimulation) {
      await wa.sendSeen(chatId);
      await wa.simulateTyping(chatId, typingDuration(this.config));
    }

    const result = await wa.sendText(item.phone, item.text);

    if (result.ok) {
      // Regla 5: guardar en sent-log ANTES de confirmar.
      store.appendSentRecord({
        phone: item.phone,
        messageId: item.messageId,
        sentByNumber: wa.getState().phoneNumber || "unknown",
        waMessageId: result.messageId,
        sentAt: new Date().toISOString(),
      });
      this.counters.sent += 1;
      this.sentToday += 1;
      this.log("sent", {
        phone: item.phone,
        messageId: item.messageId,
        waMessageId: result.messageId,
      });
    } else if (result.blocked) {
      // Detección de bloqueo: pausar campaña automáticamente (regla de negocio).
      this.counters.failed += 1;
      this.status = "blocked";
      this.finishedAt = new Date().toISOString();
      this.log("blocked_detected", {
        phone: item.phone,
        number: wa.getState().phoneNumber,
        error: result.error,
      });
    } else {
      this.counters.failed += 1;
      this.log("failed", {
        phone: item.phone,
        messageId: item.messageId,
        error: result.error,
      });
    }
  }

  /** Sleep que se interrumpe si se solicita pausa o cancelación. */
  async _interruptibleSleep(ms) {
    const step = 500;
    let elapsed = 0;
    while (elapsed < ms) {
      if (this._cancelRequested || this._pauseRequested) return;
      const chunk = Math.min(step, ms - elapsed);
      await sleep(chunk);
      elapsed += chunk;
    }
  }

  /** Estimación de tiempo restante (ms) según el delay promedio configurado. */
  estimateRemainingMs() {
    const remaining = this.queue
      .slice(this.cursor)
      .filter((i) => !i.skipReason).length;
    const avgDelay = (this.config.minDelayMs + this.config.maxDelayMs) / 2;
    const batchPauses = Math.floor(remaining / this.config.batchSize);
    return Math.round(
      remaining * avgDelay + batchPauses * this.config.batchPauseMs
    );
  }

  getStatus() {
    return {
      id: this.id,
      status: this.status,
      counters: { ...this.counters },
      cursor: this.cursor,
      total: this.counters.total,
      sentToday: this.sentToday,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      estimatedRemainingMs: this.isActive() ? this.estimateRemainingMs() : 0,
      config: this.config,
      events: this.events.slice(0, 20),
    };
  }

  /** Resumen final descargable. */
  getSummary() {
    return {
      id: this.id,
      status: this.status,
      counters: { ...this.counters },
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      config: this.config,
      events: this.events,
    };
  }
}

const engine = new CampaignEngine();
engine.renderTemplate = renderTemplate;
engine.pickMessage = pickMessage;

module.exports = engine;
