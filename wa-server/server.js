"use strict";

/**
 * Servidor Express + OpenWA para envío masivo de WhatsApp.
 * Puerto por defecto: 3001.
 *
 * Expone:
 *   /session/*   → estado de sesión y QR
 *   /messages/*  → control de campaña, registro y bloqueos
 *   /health      → healthcheck
 */

require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});

const express = require("express");
const cors = require("cors");

const wa = require("./lib/wa");
const sessionRoutes = require("./routes/session");
const messageRoutes = require("./routes/messages");

const PORT = Number(process.env.WA_SERVER_PORT) || 3001;

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, mock: wa.IS_MOCK, ts: new Date().toISOString() });
});

app.use("/session", sessionRoutes);
app.use("/messages", messageRoutes);

// Manejo centralizado de errores.
app.use((err, req, res, _next) => {
  console.error("[server] Error no controlado:", err);
  res.status(500).json({ error: err.message || "Error interno" });
});

app.listen(PORT, () => {
  console.log(
    `\n🟢 wa-server escuchando en http://localhost:${PORT}  (mock=${wa.IS_MOCK})`
  );
  // Inicia automáticamente la sesión para generar el QR cuanto antes.
  wa.start().then((state) => {
    console.log(`   Estado inicial de sesión: ${state.status}`);
  });
});

// Cierre ordenado.
process.on("SIGINT", async () => {
  console.log("\n⏹  Cerrando wa-server...");
  await wa.disconnect();
  process.exit(0);
});
