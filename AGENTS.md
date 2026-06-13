# AGENTS.md

## Cursor Cloud specific instructions

This repo is a WhatsApp bulk-sender with two services managed via npm workspaces:

- **Frontend** — Next.js 14 (App Router) on port **3000**. Proxies API calls to the wa-server.
- **wa-server** — Express + OpenWA on port **3001**. Lives in `wa-server/`.

Standard commands are in the root `package.json` and `README.md`. Quick reference:

- Run both services (dev): `npm run dev:all` (frontend `:3000`, wa-server `:3001`).
- Run individually: `npm run dev` (frontend), `npm run wa-server:dev` (wa-server).
- Lint: `npm run lint` · Typecheck: `npm run typecheck` · Build: `npm run build`.

### Non-obvious notes

- **Mock mode is the default dev mode.** With `WA_MOCK=true` (the default), the wa-server simulates the entire WhatsApp flow (QR, connection, sends, occasional blocks) — no browser or real phone needed. The app runs fully end-to-end this way. `WA_MOCK=false` (real OpenWA) requires a human to scan a QR with a real WhatsApp account and is not feasible for autonomous agents.
- **`.env` is optional for mock-mode dev.** It is gitignored. The code falls back to safe defaults (`WA_MOCK=true`, wa-server `:3001`, frontend proxy `http://localhost:3001`), so both services run without it. Copy `.env.example` to `.env` only if you need to override defaults.
- **`@open-wa/wa-automate` is an optional dependency** (heavy; pulls Puppeteer/Chromium) and is only needed for real mode. The update script installs with `--omit=optional`. For real mode: `npm install --workspace wa-server @open-wa/wa-automate` plus a system Chromium.
- **The wa-server auto-starts a session on boot.** In mock mode it transitions `qr_ready → connecting → connected` over ~7s and assigns a demo number (`573001234567`). Check `curl http://localhost:3001/health` and `curl http://localhost:3001/session/status`.
- **Port discipline matters.** Frontend must own `:3000` and wa-server `:3001`. If `:3000` is busy, Next falls back to `:3001` and collides with the wa-server, breaking everything. Free `:3000` first.
- **Default anti-block delays are 8000–25000 ms between messages.** For quick manual/E2E testing, lower "Delay mín/máx (ms)" in the UI's "Configuración y envío" section before starting a campaign.
- **Persistence:** the wa-server writes to `wa-server/data/sent-log.json` and `blocked-numbers.json`; the frontend persists campaign state to `localStorage`. To reset a demo, clear those files / browser storage.
