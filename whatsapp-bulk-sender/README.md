# WhatsApp Bulk Sender (solo Firefox)

Sistema de envío masivo de WhatsApp con Node.js + TypeScript, **exclusivamente con Firefox**, rate limiting aleatorio y tracking local con SQLite.

## Requisitos

- Node.js 18+
- **Firefox** o **Firefox ESR** instalado (Parrot OS ya lo incluye)
- Chrome y Chromium están **bloqueados** — el sistema no los usará

## Instalación

```bash
cd whatsapp-bulk-sender
npm install
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

- Se abre **Firefox** con WhatsApp Web
- También aparece el QR en la terminal
- En el teléfono: **Configuración → Dispositivos vinculados → Vincular dispositivo**

## Configuración (`.env`)

```env
SESSION_NAME=bulk-sender
HEADLESS=false          # true = Firefox sin ventana
FIREFOX_PATH=/usr/bin/firefox-esr   # opcional
QR_TIMEOUT=0            # 0 = esperar indefinidamente
DELAY_MIN_MS=8000
DELAY_MAX_MS=20000
```

## Detección automática de Firefox

El sistema busca en este orden:

1. `FIREFOX_PATH` del `.env`
2. `which firefox-esr` / `which firefox`
3. `/usr/bin/firefox-esr`, `/usr/bin/firefox`, etc.

## Stack

| Componente | Tecnología |
|------------|------------|
| Navegador | Firefox (Playwright) |
| WhatsApp API | @wppconnect/wa-js |
| Base de datos | SQLite (better-sqlite3) |
| Contactos | CSV (papaparse) |

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm start` | Desarrollo con ts-node |
| `npm run build` | Compila a `dist/` |
| `npm run start:prod` | Ejecuta compilado |

## Solución de problemas

### Se queda "pegado" sin hacer nada

1. **Actualiza el código:**
   ```bash
   git pull origin main
   cd whatsapp-bulk-sender
   npm install
   ```

2. **Borra sesión anterior corrupta:**
   ```bash
   rm -rf sessions/bulk-sender
   ```

3. **Asegúrate de tener en `.env`:**
   ```env
   HEADLESS=false
   FIREFOX_PATH=/usr/bin/firefox-esr
   ```

4. **Ejecuta y observa los pasos en consola:**
   ```
   Abriendo Firefox...
   Cargando web.whatsapp.com...
   Cargando librería de WhatsApp (WPP)...
   Esperando escaneo del QR...
   ```

5. Si ves `Aún esperando QR...` cada 15s → **es normal**, escanea el QR en Firefox o en la terminal.

6. Si se queda antes de "Cargando librería WPP", revisa que Firefox abra la ventana (no uses headless la primera vez).

### "Firefox no encontrado"

```bash
sudo apt install firefox-esr
# o define la ruta:
echo "FIREFOX_PATH=/usr/bin/firefox-esr" >> .env
```

### Se queda esperando en el QR

- Asegúrate de tener `HEADLESS=false` en `.env`
- Escanea el QR que aparece en la terminal o en la ventana de Firefox
- Borra sesión anterior si falló: `rm -rf sessions/*`

### Error de sesión corrupta

```bash
rm -rf sessions/bulk-sender
npm start
```

## Advertencia

El envío masivo puede violar los términos de WhatsApp. Usa solo con contactos que hayan dado consentimiento.
