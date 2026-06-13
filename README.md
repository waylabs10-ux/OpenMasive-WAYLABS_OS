# OpenMasive-WAYLABS_OS — WhatsApp Bulk Sender

Aplicación full-stack para **envío masivo de mensajes de WhatsApp** con
deduplicación inteligente de envíos y protección anti-bloqueo del número.

> ⚠️ **Uso responsable.** Esta herramienta automatiza WhatsApp mediante OpenWA,
> lo cual puede violar los Términos de Servicio de WhatsApp y derivar en el
> bloqueo del número. Úsala bajo tu propia responsabilidad y respeta la
> normativa de protección de datos (consentimiento, opt-out, etc.).

## 🧱 Stack

- **Frontend:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · UI estilo shadcn/ui
- **Estado:** Zustand con persistencia en `localStorage`
- **WhatsApp:** `@open-wa/wa-automate` (servidor Node.js separado)
- **Persistencia:** archivos JSON (`sent-log.json`, `blocked-numbers.json`) + `localStorage`

## 🗂️ Arquitectura

```
.
├── src/                      # Frontend Next.js (puerto 3000)
│   ├── app/                  # Dashboard + API routes (proxy hacia wa-server)
│   ├── components/           # QR, uploaders, cola de envío, historial, bloqueados
│   ├── lib/                  # validations (Zod), deduplication, wa-client, utils
│   └── store/                # Zustand store (campaña)
└── wa-server/                # Servidor Express + OpenWA (puerto 3001)
    ├── server.js
    ├── routes/               # session.js · messages.js
    ├── middleware/           # rateLimiter.js (anti-bloqueo)
    ├── lib/                  # wa.js (OpenWA + modo mock) · store.js · campaign.js
    └── data/                 # sent-log.json · blocked-numbers.json
```

## 🚀 Puesta en marcha

```bash
# 1. Instalar dependencias del frontend
npm install

# 2. Instalar dependencias del servidor WA
#    Por defecto incluye @open-wa/wa-automate (necesario para el modo REAL).
npm install --workspace wa-server
#    Si lo instalaste con --no-optional o quieres asegurarte de tener OpenWA:
npm install --workspace wa-server @open-wa/wa-automate

# 3. Configurar variables de entorno
cp .env.example .env
#   WA_MOCK=true  → modo simulado (sin navegador ni número real, ideal para pruebas)
#   WA_MOCK=false → OpenWA real (requiere Chromium y escanear el QR)

# 4. Levantar todo (frontend + wa-server)
npm run dev:all
#   Frontend:  http://localhost:3000
#   wa-server: http://localhost:3001
```

También puedes ejecutarlos por separado con `npm run dev` y `npm run wa-server:dev`.

### Modo simulado (`WA_MOCK=true`)

Reproduce el flujo completo sin un WhatsApp real: genera un QR ficticio, simula
la conexión tras unos segundos, envía mensajes con delays y, ocasionalmente,
simula un bloqueo para que puedas ver la protección en acción. Perfecto para
desarrollo y demos.

### Modo real (`WA_MOCK=false`)

> **Importante:** el modo real requiere que `@open-wa/wa-automate` esté instalado.
> Si pones `WA_MOCK=false` pero OpenWA **no** está instalado, el servidor seguirá
> en modo simulado como respaldo y lo avisará en consola:
>
> ```
> [wa] ⚠️  WA_MOCK=false pero '@open-wa/wa-automate' NO está instalado...
> ```
>
> Solución: `npm install --workspace wa-server @open-wa/wa-automate` y reinicia el
> `wa-server`. Necesitas Chromium disponible (OpenWA lo descarga o usa
> `PUPPETEER_EXECUTABLE_PATH`).

## 🧪 Flujo de uso

1. Inicia sesión y escanea el QR (o espera la conexión en modo mock).
2. Carga el JSON de **contactos** (`samples/contacts.example.json`).
3. Carga el JSON de **mensajes** (`samples/messages.example.json`).
4. Ajusta la configuración anti-bloqueo (delays, lote, selección de mensaje).
5. Pulsa **Iniciar campaña** y sigue el progreso en tiempo real.

## 🩺 Solución de problemas

### `net::ERR_CONNECTION_REFUSED` en `:3000/api/...`

Significa que **el frontend de Next.js no está corriendo en el puerto 3000**.
Causa habitual: el 3000 estaba ocupado y Next arrancó en otro puerto
(verás en consola `⚠ Port 3000 is in use, trying 3001 instead`). Si Next cae
en el **3001 choca con el `wa-server`** y todo deja de funcionar.

**Solución:**

1. Asegúrate de que **solo** el frontend use el 3000 y **solo** el `wa-server`
   el 3001 (no los inicies dos veces).
2. Libera el puerto 3000 si está ocupado:
   ```bash
   # Linux/macOS
   lsof -ti:3000 | xargs kill -9
   # Windows (PowerShell)
   npx kill-port 3000
   ```
3. Vuelve a arrancar con `npm run dev:all` y abre **exactamente** la URL que
   imprime Next (`http://localhost:3000`).

### El frontend dice "No se pudo contactar el wa-server"

El frontend (3000) está bien, pero el `wa-server` (3001) no responde. Inícialo
con `npm run wa-server:dev` y confirma que imprime
`🟢 wa-server escuchando en http://localhost:3001`.

### `TimeoutError: Waiting failed: 30000ms exceeded` (OpenWA / Puppeteer)

OpenWA no consiguió arrancar el navegador. Causas y solución (en orden):

1. **Sesión corrupta:** borra la carpeta de sesión y reintenta:
   ```bash
   rm -rf wa-server/_IGNORE_wa-bulk-sender wa-server/*.data.json
   ```
2. **Sandbox/dependencias de Chromium (Linux):** ya pasamos `--no-sandbox` y
   `--disable-dev-shm-usage` por defecto. Asegúrate de tener instalado Chrome/
   Chromium y sus librerías:
   ```bash
   # Debian/Ubuntu
   sudo apt-get install -y chromium-browser \
     libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2 libgbm1
   ```
3. **Usa el Chrome del sistema** (recomendado) e indica su ruta si no se detecta:
   ```bash
   # en .env
   WA_USE_CHROME=true
   WA_CHROME_PATH=/usr/bin/google-chrome   # o /usr/bin/chromium-browser
   ```
4. **Depurar viendo el navegador:** pon `WA_HEADLESS=false` en `.env` para ver
   qué ocurre al cargar WhatsApp Web.

Tras cambiar el `.env`, reinicia el `wa-server`.

## 🛡️ Reglas de negocio (sin excepciones)

1. Nunca se envía el mismo `phone + messageId` dos veces (deduplicación).
2. Nunca se usa un número bloqueado para nuevos envíos.
3. Nunca se contacta a un contacto ya alcanzado por un número bloqueado.
4. Delays siempre aleatorios, nunca intervalos fijos.
5. Se guarda en `sent-log.json` antes de confirmar cada envío.
6. La app sobrevive a cierres/reaperturas (persistencia en JSON + localStorage).
7. El servidor WA reintenta reconexión (máx. 3 intentos).

## 🔧 Configuración anti-bloqueo (por defecto)

| Parámetro            | Valor    | Descripción                         |
| -------------------- | -------- | ----------------------------------- |
| `minDelayMs`         | 8000     | Delay mínimo entre mensajes         |
| `maxDelayMs`         | 25000    | Delay máximo entre mensajes         |
| `batchSize`          | 30       | Mensajes antes de una pausa larga   |
| `batchPauseMs`       | 300000   | Pausa de 5 min entre lotes          |
| `maxDailyMessages`   | 150      | Límite diario por número            |
| `typingSimulation`   | true     | Simula "escribiendo…" antes de enviar |

## 🐳 Docker (opcional)

```bash
docker compose up --build
```

## 📡 API del wa-server

| Método | Ruta                         | Descripción                       |
| ------ | ---------------------------- | --------------------------------- |
| GET    | `/session/status`            | Estado de sesión y QR             |
| POST   | `/session/start`             | Inicia sesión / genera QR         |
| POST   | `/session/disconnect`        | Cierra la sesión                  |
| POST   | `/messages/campaign/start`   | Inicia una campaña                |
| GET    | `/messages/campaign/status`  | Progreso de la campaña            |
| POST   | `/messages/campaign/pause`   | Pausa la campaña                  |
| POST   | `/messages/campaign/resume`  | Reanuda la campaña                |
| POST   | `/messages/campaign/cancel`  | Cancela la campaña                |
| GET    | `/messages/sent-log`         | Registro de envíos                |
| GET    | `/messages/blocked`          | Números bloqueados                |
| POST   | `/messages/blocked/exclude`  | Excluye/incluye un número         |
