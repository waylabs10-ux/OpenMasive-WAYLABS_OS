"use strict";

/**
 * Rutas de sesión de WhatsApp: estado, QR, iniciar y cerrar sesión.
 */

const express = require("express");
const wa = require("../lib/wa");

const router = express.Router();

// Estado actual de la sesión (el frontend hace polling cada 3s).
router.get("/status", (req, res) => {
  res.json(wa.getState());
});

// Inicia la sesión (genera QR si es necesario).
router.post("/start", async (req, res) => {
  const state = await wa.start();
  res.json(state);
});

// Cierra y destruye la sesión actual.
router.post("/disconnect", async (req, res) => {
  const state = await wa.disconnect();
  res.json(state);
});

// Reintento manual de reconexión.
router.post("/reconnect", async (req, res) => {
  const ok = await wa.tryReconnect();
  res.json({ ok, ...wa.getState() });
});

module.exports = router;
