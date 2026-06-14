import {
  DELAY_MAX_MS,
  DELAY_MIN_MS,
  formatMessage,
  log,
  randomDelay,
} from './config';
import { Contact } from './csvLoader';
import { isAlreadySent, markAsSent } from './tracker';
import { WaClient } from './types';

interface BulkSummary {
  sent: number;
  skipped: number;
  failed: number;
}

export async function sendBulkMessages(
  client: WaClient,
  contacts: Contact[],
  messageTemplate: string
): Promise<BulkSummary> {
  const total = contacts.length;
  const summary: BulkSummary = { sent: 0, skipped: 0, failed: 0 };

  log(`Iniciando envío masivo a ${total} contactos...`, 'info');
  await client.waitUntilReady();

  for (let i = 0; i < contacts.length; i++) {
    const { phone, name } = contacts[i];
    const index = i + 1;

    if (isAlreadySent(phone)) {
      log(`⏭️ Saltando ${phone} - ya enviado`, 'skip');
      summary.skipped++;
      continue;
    }

    try {
      log(`Verificando ${phone} (${index}/${total})...`, 'info');
      const status = await client.checkNumberStatus(phone);

      if (!status.numberExists || !status.wid) {
        markAsSent(phone, name, 'failed', 'not_on_whatsapp');
        log(`❌ ${phone} no está en WhatsApp`, 'error');
        summary.failed++;
        continue;
      }

      const message = formatMessage(messageTemplate, name);
      log(`Enviando a ${status.wid}...`, 'info');
      await client.sendText(status.wid, message);

      markAsSent(phone, name, 'success');
      summary.sent++;
      log(`📤 Enviado ${index}/${total} - ${phone}`, 'success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      markAsSent(phone, name, 'failed', errorMessage);
      log(`❌ Error enviando a ${phone}: ${errorMessage}`, 'error');
      summary.failed++;
    }

    if (i < contacts.length - 1) {
      const delayMs = Math.floor(
        Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1) + DELAY_MIN_MS
      );
      log(`Esperando ${(delayMs / 1000).toFixed(1)}s antes del siguiente envío...`, 'info');
      await randomDelay(DELAY_MIN_MS, DELAY_MAX_MS);
    }
  }

  log('────────── RESUMEN ──────────', 'info');
  log(`✅ Enviados:  ${summary.sent}`, 'success');
  log(`⏭️ Saltados:  ${summary.skipped}`, 'skip');
  log(`❌ Fallidos:  ${summary.failed}`, 'error');
  log('─────────────────────────────', 'info');

  return summary;
}
