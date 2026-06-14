# WhatsApp Bulk Sender (solo Firefox)

Sistema de envío masivo de WhatsApp con **Firefox** (vía Playwright), rate limiting y tracking SQLite.

## Requisitos

- Node.js 18+
- Firefox de Playwright (se instala automáticamente con `npm install`)
- Chrome y Chromium están **bloqueados**

> **Importante:** Playwright **no puede** automatizar `firefox-esr` del sistema (Parrot/Ubuntu). Usa su propio Firefox (motor Gecko real, parcheado para automatización). Esto es una limitación de Playwright, no del proyecto.

## Instalación

```bash
cd whatsapp-bulk-sender
npm install
npm run setup    # por si falló el postinstall
cp .env.example .env
```

## Uso

### 1. Contactos (`data/contacts.csv`)

```csv
phone,name
3001234567,Juan Pérez
3109876543,María García
```

### 2. Mensaje (`data/message.txt`)

```
Hola {name}, este es un mensaje de prueba.
```

### 3. Ejecutar

```bash
npm start
```

### 4. Escanear QR

- Se abre **Firefox** (Playwright)
- Aparece el QR en la terminal
- WhatsApp → **Dispositivos vinculados** → escanear

## Configuración (`.env`)

```env
SESSION_NAME=bulk-sender
HEADLESS=false
QR_TIMEOUT=0
DELAY_MIN_MS=8000
DELAY_MAX_MS=20000
```

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm install` | Instala deps + Firefox de Playwright |
| `npm run setup` | Reinstala Firefox de Playwright |
| `npm start` | Ejecutar envío masivo |
| `npm run build` | Compilar TypeScript |

## Solución de problemas

### Error: "Firefox de Playwright no está instalado"

```bash
npx playwright install firefox
# o
npm run setup
```

### Error: "Failed to launch" con firefox-esr del sistema

No uses `FIREFOX_PATH=/usr/bin/firefox-esr`. Eso no funciona con Playwright. Ejecuta `npm run setup`.

### Se queda esperando QR

```bash
pkill -f firefox || true
rm -rf sessions/bulk-sender
npm start
```

Asegúrate de tener `HEADLESS=false` en `.env`.

## Advertencia

Usa solo con contactos que hayan dado consentimiento. El envío masivo puede violar los términos de WhatsApp.
