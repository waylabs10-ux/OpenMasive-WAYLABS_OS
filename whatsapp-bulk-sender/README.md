# WhatsApp Bulk Sender

Sistema de envío masivo de WhatsApp con Node.js + TypeScript, rate limiting aleatorio y tracking local con SQLite para evitar envíos duplicados.

## Stack

- **Runtime:** Node.js 18+
- **Librería:** [@open-wa/wa-automate](https://github.com/open-wa/wa-automate-nodejs) (versión gratuita)
- **Base de datos:** SQLite con `better-sqlite3`
- **Lenguaje:** TypeScript
- **Contactos:** CSV

## Estructura

```
whatsapp-bulk-sender/
├── src/
│   ├── index.ts       # Entry point, inicializa el cliente WA
│   ├── sender.ts      # Lógica de envío con rate limiting
│   ├── tracker.ts     # SQLite - registra números enviados
│   ├── csvLoader.ts   # Lee y parsea el CSV de contactos
│   └── config.ts      # Configuración centralizada
├── data/
│   ├── contacts.csv   # Columnas: phone, name (opcional)
│   ├── message.txt    # Mensaje a enviar (soporte {name})
│   └── sent.db        # SQLite auto-generada
├── sessions/          # Sesión de @open-wa/wa-automate
├── package.json
├── tsconfig.json
└── .env
```

## Requisitos previos

- Node.js 18 o superior
- npm

## Instalación y uso

### 1. Instalar dependencias

```bash
cd whatsapp-bulk-sender
npm install
```

### 2. Configurar contactos

Edita `data/contacts.csv` con las columnas `phone` y `name` (opcional):

```csv
phone,name
3001234567,Juan Pérez
3109876543,María García
3205551234,
```

**Normalización de números:**
- Se eliminan espacios, guiones y paréntesis
- Si empieza con `0`, se remueve
- Números colombianos de 10 dígitos que empiezan en `3` reciben prefijo `57`
- Se valida que tengan entre 10 y 13 dígitos

### 3. Escribir el mensaje

Edita `data/message.txt`. Puedes usar la variable `{name}`:

```
Hola {name}, este es un mensaje de prueba.
```

Si el contacto no tiene nombre, se usa `estimado/a`.

### 4. Configurar variables de entorno

Copia el ejemplo y ajústalo según tu entorno:

```bash
cp .env.example .env
```

```env
SESSION_NAME=bulk-sender
DELAY_MIN_MS=8000
DELAY_MAX_MS=20000
HEADLESS=false        # false = ventana visible con QR (recomendado la 1ª vez)
USE_POPUP=true        # QR en http://localhost:3000/qr
QR_TIMEOUT=0          # 0 = esperar indefinidamente
AUTH_TIMEOUT=0
```

### 5. Ejecutar

```bash
npm start
```

### 6. Escanear QR

Al iniciar, se muestra un código QR en la consola. Escanéalo con WhatsApp en tu teléfono (Dispositivos vinculados).

### 7. Envío automático

Una vez autenticado, el sistema:
- Carga los contactos del CSV
- Verifica en SQLite si ya fueron enviados (no repite)
- Valida que cada número exista en WhatsApp
- Envía con delay aleatorio entre 8 y 20 segundos
- Registra éxito o fallo en `data/sent.db`

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm start` | Ejecuta en desarrollo con ts-node |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm run start:prod` | Ejecuta la versión compilada |

## Rate limiting

Para reducir riesgo de bloqueo, cada mensaje espera un tiempo aleatorio entre `DELAY_MIN_MS` (8s) y `DELAY_MAX_MS` (20s) antes del siguiente envío.

## Tracking SQLite

La tabla `sent_messages` guarda:
- `phone` — número en formato WhatsApp (`573001234567@c.us`)
- `name` — nombre del contacto
- `status` — `success` o `failed`
- `error_message` — detalle del error si falló
- `sent_at` — timestamp del envío

Los números con `status = success` se omiten en ejecuciones posteriores.

## Logs

Formato: `[HH:MM:SS] mensaje`

| Color | Tipo |
|-------|------|
| Verde | Éxito |
| Amarillo | Skip (ya enviado) |
| Rojo | Error |
| Cyan | Info |

## Solución de problemas

### Se queda en "Page loaded" sin mostrar QR

Esto es normal en la primera ejecución: el sistema **espera que escanees el QR**. Prueba:

1. **Crear `.env`** desde el ejemplo:
   ```bash
   cp .env.example .env
   ```

2. **Usar ventana visible** (más fácil la primera vez):
   ```env
   HEADLESS=false
   USE_POPUP=true
   ```

3. **Abrir el QR en el navegador** mientras corre `npm start`:
   ```
   http://localhost:3000/qr?sessionId=bulk-sender
   ```

4. **No uses `chromiumArgs`** con multi-device (causa bloqueos). Solo activa en Docker:
   ```env
   ENABLE_NO_SANDBOX=true
   ```

5. **Espera 1-2 minutos** después de escanear antes de reiniciar (recomendación de @open-wa).

6. Si falla, borra sesiones anteriores y reintenta:
   ```bash
   rm -rf sessions/* _IGNORE_*
   ```

## Advertencia

El envío masivo puede violar los términos de servicio de WhatsApp. Usa este sistema bajo tu propia responsabilidad y solo con contactos que hayan dado consentimiento.
