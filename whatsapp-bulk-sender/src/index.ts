import { create, Client } from '@open-wa/wa-automate';
import fs from 'fs';
import {
  CONTACTS_CSV,
  HEADLESS,
  log,
  MESSAGE_FILE,
  SESSION_NAME,
  USE_CHROME,
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

  client = await create({
    sessionId: SESSION_NAME,
    headless: HEADLESS,
    useChrome: USE_CHROME,
    qrTimeout: 60,
    authTimeout: 60,
    killProcessOnBrowserClose: true,
    throwErrorOnTosBlock: false,
    chromiumArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
    qrLogSkip: false,
    disableSpins: true,
    multiDevice: true,
  });

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
