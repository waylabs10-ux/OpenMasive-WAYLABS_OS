"use strict";

/**
 * Rutas de mensajería: control de campaña, registro de envíos y bloqueos.
 */

const express = require("express");
const campaign = require("../lib/campaign");
const store = require("../lib/store");
const wa = require("../lib/wa");

const router = express.Router();

// ─────────────────────────── Control de campaña ───────────────────────────

router.post("/campaign/start", (req, res) => {
  const { contacts, messages, config } = req.body || {};

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "Se requieren contactos" });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Se requieren mensajes" });
  }

  const waState = wa.getState();
  if (waState.status !== "connected") {
    return res
      .status(409)
      .json({ error: "WhatsApp no está conectado", status: waState.status });
  }
  // Regla 2: nunca usar un número bloqueado.
  if (waState.phoneNumber && store.isNumberBlocked(waState.phoneNumber)) {
    return res.status(403).json({
      error: "El número actual está bloqueado y no puede usarse",
      number: waState.phoneNumber,
    });
  }

  try {
    const status = campaign.start({ contacts, messages, config });
    res.json(status);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

router.get("/campaign/status", (req, res) => {
  res.json(campaign.getStatus());
});

router.post("/campaign/pause", (req, res) => {
  res.json(campaign.pause());
});

router.post("/campaign/resume", (req, res) => {
  res.json(campaign.resume());
});

router.post("/campaign/cancel", (req, res) => {
  res.json(campaign.cancel());
});

router.get("/campaign/summary", (req, res) => {
  res.json(campaign.getSummary());
});

// ─────────────────────────── Registro y bloqueos ──────────────────────────

router.get("/sent-log", (req, res) => {
  res.json(store.getSentLog());
});

router.get("/blocked", (req, res) => {
  res.json(store.getBlockedNumbers());
});

// Excluir/incluir manualmente un número de campañas futuras.
router.post("/blocked/exclude", (req, res) => {
  const { number, excluded = true } = req.body || {};
  if (!number) {
    return res.status(400).json({ error: "Falta el número" });
  }
  const blocked = store.setManualExclusion(number, excluded);
  res.json(blocked);
});

// Envío individual (utilidad / pruebas) respetando dedup.
router.post("/send", async (req, res) => {
  const { phone, messageId, text } = req.body || {};
  if (!phone || !messageId || !text) {
    return res
      .status(400)
      .json({ error: "Se requieren phone, messageId y text" });
  }
  if (store.hasBeenSent(phone, messageId)) {
    return res.json({ ok: true, skipped: true, reason: "duplicate" });
  }
  const result = await wa.sendText(phone, text);
  if (result.ok) {
    store.appendSentRecord({
      phone,
      messageId,
      sentByNumber: wa.getState().phoneNumber || "unknown",
      waMessageId: result.messageId,
    });
  }
  res.json(result);
});

module.exports = router;
