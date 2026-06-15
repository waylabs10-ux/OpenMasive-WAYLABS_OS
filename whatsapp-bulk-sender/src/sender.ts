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

function simplifyError(message: string): string {
  const firstLine = message.split('\n')[0];
  if (firstLine.includes('invariant')) {
    return 'Número inválido o sin chat en WhatsApp';
  }
  if (firstLine.includes('sin ACK')) {
    return 'WhatsApp no confirmó el envío';
  }
  if (
    firstLine.includes('execution context was destroyed') ||
    firstLine.includes('wpp is undefined') ||
    firstLine.includes("can't access property")
  ) {
    return 'Sesión de WhatsApp interrumpida (reintenta el envío)';
  }
  return firstLine.length > 180 ? `${firstLine.slice(0, 180)}...` : firstLine;
}

function isNotOnWhatsAppError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('not registered') ||
    lower.includes('not found') ||
    lower.includes('invalid wid') ||
    lower.includes('no lid') ||
    lower.includes('not exist') ||
    lower.includes('no registrado') ||
    lower.includes('sin chat')
  );
}

export async function sendBulkMessages(
  client: WaClient,
  contacts: Contact[],
  messageTemplate: string
): Promise<BulkSummary> {
  const total = contacts.length;
  const summary: BulkSummary = { sent: 0, skipped: 0, failed: 0 };
  const pending = contacts.filter((contact) => !isAlreadySent(contact.phone)).length;
  const alreadySent = total - pending;

  log(`Iniciando envío masivo a ${total} contactos...`, 'info');
  if (alreadySent > 0) {
    log(
      `${alreadySent} contacto(s) ya enviados previamente serán omitidos. Borra data/sent.db para reenviar a todos.`,
      'skip'
    );
  }
  log(`${pending} contacto(s) pendientes por enviar.`, 'info');
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
      const message = formatMessage(messageTemplate, name);
      log(`📤 Enviando ${index}/${total} → ${phone}`, 'info');
      const result = await client.sendText(phone, message);

      markAsSent(phone, name, 'success');
      summary.sent++;
      log(
        `✅ Enviado ${index}/${total} - ${phone} (ack=${result.ack}, id=${result.messageId})`,
        'success'
      );
      if (result.to) {
        log(`   Destino confirmado por WhatsApp: ${result.to}`, 'info');
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const errorMessage = simplifyError(rawMessage);
      const status = isNotOnWhatsAppError(errorMessage)
        ? 'not_on_whatsapp'
        : errorMessage;

      markAsSent(phone, name, 'failed', status);
      log(`❌ Error con ${phone}: ${errorMessage}`, 'error');
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
