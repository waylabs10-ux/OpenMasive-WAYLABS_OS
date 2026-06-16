import fs from 'fs';
import {
  CONTACTS_CSV,
  log,
  MESSAGE_FILE,
} from './config';
import { createFirefoxClient } from './firefoxClient';
import { loadContacts } from './csvLoader';
import { logBus } from './logBus';
import { generateCampaignReport } from './campaignReport';
import { getOptoutCount, readOptoutRaw } from './optout';
import { sendBulkMessages } from './sender';
import {
  attachIncomingListener,
  bindAutoReplyContext,
  getAutoReplyConfig,
  getAutoReplyStatus,
  getRecentAutoReplies,
  readAutoReplyPrompt,
  resetAutoReplyListener,
  saveAutoReplyConfig,
  saveAutoReplyPrompt,
} from './autoReplyService';
import {
  closeDatabase,
  finishCampaign,
  getFailedCount,
  getHistory,
  getSentCount,
  listCampaigns,
  getCampaign,
  persistOptoutList,
  resetDatabase,
  startCampaign,
} from './tracker';
import { WaClient } from './types';

export type SessionState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'sending'
  | 'error';

export interface AppStatus {
  session: SessionState;
  sending: boolean;
  sent: number;
  skipped: number;
  failed: number;
  excluded: number;
  optoutCount: number;
  contactCount: number;
  autoReplyEnabled: boolean;
  autoReplyProcessing: boolean;
  aiConfigured: boolean;
  lastError?: string;
}

let client: WaClient | null = null;
let sessionState: SessionState = 'idle';
let sending = false;
let sendAbort: AbortController | null = null;
let lastSummary = { sent: 0, skipped: 0, failed: 0, excluded: 0 };
let lastError: string | undefined;

bindAutoReplyContext({
  getClient: () => client,
  isBulkSending: () => sending,
});

function buildAppStatus(): AppStatus {
  let contactCount = 0;
  try {
    if (fs.existsSync(CONTACTS_CSV)) {
      contactCount = loadContacts().length;
    }
  } catch {
    contactCount = 0;
  }

  const autoReply = getAutoReplyStatus();

  return {
    session: sessionState,
    sending,
    sent: sending ? lastSummary.sent : getSentCount(),
    skipped: sending ? lastSummary.skipped : 0,
    failed: sending ? lastSummary.failed : getFailedCount(),
    excluded: sending ? lastSummary.excluded : 0,
    optoutCount: getOptoutCount(),
    contactCount,
    autoReplyEnabled: autoReply.enabled,
    autoReplyProcessing: autoReply.processing,
    aiConfigured: autoReply.aiConfigured,
    lastError,
  };
}

function emitStatus(): void {
  const status = buildAppStatus();

  logBus.emitStatus({
    session: status.session,
    sending: status.sending,
    sent: status.sent,
    skipped: status.skipped,
    failed: status.failed,
    excluded: status.excluded,
    optoutCount: status.optoutCount,
    contactCount: status.contactCount,
    autoReplyEnabled: status.autoReplyEnabled,
    autoReplyProcessing: status.autoReplyProcessing,
  });
}

export function getStatus(): AppStatus {
  return buildAppStatus();
}

export async function connectWhatsApp(): Promise<void> {
  if (sessionState === 'connecting' || sessionState === 'ready') {
    return;
  }

  sessionState = 'connecting';
  lastError = undefined;
  emitStatus();

  try {
    log('Conectando WhatsApp Web en Firefox...', 'info');
    client = await createFirefoxClient();
    attachIncomingListener(client);
    sessionState = 'ready';
    log('WhatsApp listo para enviar desde el panel web.', 'success');
    if (getAutoReplyConfig().enabled) {
      log('Bot de respuestas IA activo (escuchando mensajes entrantes).', 'info');
    }
    emitStatus();
  } catch (err) {
    sessionState = 'error';
    lastError = err instanceof Error ? err.message : String(err);
    log(`Error al conectar: ${lastError}`, 'error');
    emitStatus();
    throw err;
  }
}

export async function startBulkSend(campaignName?: string): Promise<void> {
  if (!client || sessionState !== 'ready') {
    throw new Error('Conecta WhatsApp antes de iniciar el envío');
  }
  if (sending) {
    throw new Error('Ya hay un envío en curso');
  }

  const contacts = loadContacts();
  if (contacts.length === 0) {
    throw new Error('No hay contactos en data/contacts.csv');
  }

  if (!fs.existsSync(MESSAGE_FILE)) {
    throw new Error('No existe data/message.txt');
  }

  const messageTemplate = fs.readFileSync(MESSAGE_FILE, 'utf-8').trim();
  if (!messageTemplate) {
    throw new Error('El mensaje está vacío');
  }

  const displayName =
    campaignName?.trim() ||
    `Campaña ${new Date().toLocaleDateString('es-CO')} ${new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;

  const campaignId = startCampaign(
    displayName,
    contacts.length,
    messageTemplate.slice(0, 200)
  );

  sending = true;
  sendAbort = new AbortController();
  sessionState = 'sending';
  emitStatus();

  try {
    lastSummary = await sendBulkMessages(client, contacts, messageTemplate, {
      abortSignal: sendAbort.signal,
    });
    sessionState = 'ready';

    const report = generateCampaignReport(
      {
        name: displayName,
        totalContacts: contacts.length,
        sent: lastSummary.sent,
        skipped: lastSummary.skipped,
        failed: lastSummary.failed,
        excluded: lastSummary.excluded,
        messagePreview: messageTemplate,
      },
      campaignId
    );

    finishCampaign(campaignId, {
      sent: lastSummary.sent,
      skipped: lastSummary.skipped,
      failed: lastSummary.failed,
      excluded: lastSummary.excluded,
      reportCsv: report.csvPath,
      reportHtml: report.htmlPath,
    });

    log('Envío masivo completado desde el panel web.', 'success');
    log(`Informe de campaña generado (HTML + CSV). ID: ${campaignId}`, 'success');
  } catch (err) {
    if (sendAbort.signal.aborted) {
      sessionState = 'ready';
      log('Envío detenido por el usuario.', 'skip');
    } else {
      sessionState = 'error';
      lastError = err instanceof Error ? err.message : String(err);
      log(`Error en envío: ${lastError}`, 'error');
      throw err;
    }
  } finally {
    sending = false;
    sendAbort = null;
    emitStatus();
  }
}

export function stopBulkSend(): void {
  if (sendAbort && !sendAbort.signal.aborted) {
    sendAbort.abort();
  }
}

export async function disconnectWhatsApp(): Promise<void> {
  stopBulkSend();

  if (client) {
    try {
      await client.kill();
    } catch {
      // ignore
    }
    client = null;
  }

  resetAutoReplyListener();
  sessionState = 'idle';
  emitStatus();
  log('Sesión de WhatsApp cerrada.', 'info');
}

export function clearSentHistory(): void {
  resetDatabase();
  lastSummary = { sent: 0, skipped: 0, failed: 0, excluded: 0 };
  emitStatus();
  log('Historial de envíos borrado (data/sent.db).', 'info');
}

export function getSendHistory() {
  return getHistory();
}

export function getCampaignsList() {
  return listCampaigns();
}

export function getCampaignById(id: number) {
  return getCampaign(id);
}

export function getOptoutContent(): string {
  return readOptoutRaw();
}

export function saveOptoutContent(content: string): number {
  const count = persistOptoutList(content);
  log(`${count} número(s) en lista de exclusión Habeas Data.`, 'info');
  emitStatus();
  return count;
}

export function getAutoReplySettings() {
  return getAutoReplyConfig();
}

export function updateAutoReplySettings(
  partial: Parameters<typeof saveAutoReplyConfig>[0]
) {
  const config = saveAutoReplyConfig(partial);
  if (config.enabled && client && sessionState === 'ready') {
    attachIncomingListener(client);
    log('Bot de respuestas IA activado.', 'success');
  } else if (!config.enabled) {
    log('Bot de respuestas IA desactivado.', 'info');
  }
  emitStatus();
  return config;
}

export function getAutoReplyPromptContent(): string {
  return readAutoReplyPrompt();
}

export function saveAutoReplyPromptContent(content: string): void {
  saveAutoReplyPrompt(content);
  log('Prompt del bot IA guardado.', 'success');
}

export function getAutoReplyHistory(limit = 50) {
  return getRecentAutoReplies(limit);
}

export async function shutdownApp(): Promise<void> {
  await disconnectWhatsApp();
  closeDatabase();
}
