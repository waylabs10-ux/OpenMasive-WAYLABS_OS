import { create, Client } from '@open-wa/wa-automate';
import fs from 'fs';
import {
  AUTH_TIMEOUT,
  CONTACTS_CSV,
  ENABLE_NO_SANDBOX,
  HEADLESS,
  log,
  MESSAGE_FILE,
  POPUP_PORT,
  QR_TIMEOUT,
  SESSION_DATA_PATH,
  SESSION_NAME,
  USE_CHROME,
  USE_POPUP,
} from './config';
import { loadContacts } from './csvLoader';
import { sendBulkMessages } from './sender';
import { closeDatabase } from './tracker';

let client: Client | null = null;

async function loadMessageTemplate(): Promise<string> {
  if (!fs.existsSync(MESSAGE_FILE)) {
    throw new Error(`Archivo de mensaje no encontrado: ${MESSAGE_FILE}`);
  }
  return fs.readFileSync(MESSAGE_FILE, 'utf-8').trim();
}

async function shutdown(): Promise<void> {
  log('Cerrando sesión de WhatsApp...', 'info');
  if (client) {
    try {
      await client.kill();
    } catch {
      // ignore cleanup errors
    }
  }
  closeDatabase();
  process.exit(0);
}

async function main(): Promise<void> {
  log('Iniciando WhatsApp Bulk Sender...', 'info');
  log(`Sesión: ${SESSION_NAME}`, 'info');
  log(`Contactos: ${CONTACTS_CSV}`, 'info');

  if (!fs.existsSync(SESSION_DATA_PATH)) {
    fs.mkdirSync(SESSION_DATA_PATH, { recursive: true });
  }

  if (HEADLESS) {
    log('Modo headless activo. Espera el QR en consola o abre el popup en el navegador.', 'info');
  } else {
    log('Se abrirá una ventana de Chromium. Escanea el QR ahí.', 'info');
  }

  if (USE_POPUP) {
    log(
      `QR también disponible en: http://localhost:${POPUP_PORT}/qr?sessionId=${SESSION_NAME}`,
      'info'
    );
  }

  log('Esperando autenticación de WhatsApp (puede tardar 1-2 minutos)...', 'info');

  const waConfig: Parameters<typeof create>[0] = {
    sessionId: SESSION_NAME,
    sessionDataPath: SESSION_DATA_PATH,
    headless: HEADLESS,
    useChrome: USE_CHROME,
    qrTimeout: QR_TIMEOUT,
    authTimeout: AUTH_TIMEOUT,
    killProcessOnBrowserClose: true,
    throwErrorOnTosBlock: false,
    qrLogSkip: false,
    disableSpins: false,
    multiDevice: true,
    popup: USE_POPUP ? POPUP_PORT : false,
    ezqr: USE_POPUP,
    waitForRipeSession: false,
    waitForRipeSessionTimeout: 0,
    logConsoleErrors: true,
  };

  if (ENABLE_NO_SANDBOX) {
    waConfig.chromiumArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    log('ENABLE_NO_SANDBOX=true (solo recomendado en Docker/Linux sin display)', 'info');
  }

  client = await create(waConfig);

  log('✅ Autenticación exitosa. Sesión de WhatsApp lista.', 'success');

  const contacts = loadContacts();
  if (contacts.length === 0) {
    log('No hay contactos para enviar. Revisa data/contacts.csv', 'error');
    await shutdown();
    return;
  }

  const messageTemplate = await loadMessageTemplate();
  if (!messageTemplate) {
    log('El archivo de mensaje está vacío. Escribe un mensaje en data/message.txt', 'error');
    await shutdown();
    return;
  }

  await sendBulkMessages(client, contacts, messageTemplate);

  log('Proceso completado.', 'success');
  await shutdown();
}

process.on('SIGINT', () => {
  log('SIGINT recibido. Cerrando limpiamente...', 'info');
  void shutdown();
});

process.on('SIGTERM', () => {
  log('SIGTERM recibido. Cerrando limpiamente...', 'info');
  void shutdown();
});

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  log(`Error fatal: ${message}`, 'error');
  closeDatabase();
  process.exit(1);
});
