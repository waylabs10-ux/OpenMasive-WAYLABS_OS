import fs from 'fs';
import path from 'path';
import { generateAiReply, isAiConfigured } from './aiService';
import {
  AUTOREPLY_CONFIG_FILE,
  AUTOREPLY_PROMPT_FILE,
  log,
} from './config';
import { logBus } from './logBus';
import { isOptedOut } from './optout';
import {
  getAutoReplyLog,
  insertAutoReplyLog,
  wasMessageHandled,
} from './tracker';
import { IncomingMessage, WaClient } from './types';

export interface AutoReplyConfig {
  enabled: boolean;
  replyInGroups: boolean;
  cooldownSeconds: number;
  maxHistoryMessages: number;
}

const DEFAULT_CONFIG: AutoReplyConfig = {
  enabled: false,
  replyInGroups: false,
  cooldownSeconds: 20,
  maxHistoryMessages: 8,
};

const DEFAULT_PROMPT = `Eres el asistente virtual de VOTOMAP, plataforma de marketing político y digital de DRAN DIGITAL S.A.S en Colombia.

Responde siempre en español, de forma breve (máximo 3 párrafos cortos), amable y profesional.
Si no sabes algo con certeza, indica que un asesor humano dará seguimiento pronto.
Nunca inventes datos de campañas, encuestas ni promesas electorales.
Si alguien pide no ser contactado o dejar de recibir mensajes, confirma amablemente que será excluido de futuros envíos (Ley 1581 de 2012).
No uses markdown ni listas numeradas; escribe como un mensaje natural de WhatsApp.`;

let config: AutoReplyConfig = { ...DEFAULT_CONFIG };
let listenerAttached = false;
let processing = false;
const chatHistory = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();
const lastReplyAt = new Map<string, number>();
const seenMessageIds = new Set<string>();

let getClient: (() => WaClient | null) | null = null;
let isBulkSending: (() => boolean) | null = null;

function ensureDataDir(): void {
  fs.mkdirSync(path.dirname(AUTOREPLY_CONFIG_FILE), { recursive: true });
}

function loadConfigFromDisk(): void {
  ensureDataDir();
  if (fs.existsSync(AUTOREPLY_CONFIG_FILE)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(AUTOREPLY_CONFIG_FILE, 'utf-8')
      ) as Partial<AutoReplyConfig>;
      config = { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      config = { ...DEFAULT_CONFIG };
    }
  }

  if (!fs.existsSync(AUTOREPLY_PROMPT_FILE)) {
    fs.writeFileSync(AUTOREPLY_PROMPT_FILE, DEFAULT_PROMPT, 'utf-8');
  }
}

loadConfigFromDisk();

export function bindAutoReplyContext(deps: {
  getClient: () => WaClient | null;
  isBulkSending: () => boolean;
}): void {
  getClient = deps.getClient;
  isBulkSending = deps.isBulkSending;
}

export function getAutoReplyConfig(): AutoReplyConfig & { aiConfigured: boolean } {
  return { ...config, aiConfigured: isAiConfigured() };
}

export function saveAutoReplyConfig(partial: Partial<AutoReplyConfig>): AutoReplyConfig {
  config = { ...config, ...partial };
  ensureDataDir();
  fs.writeFileSync(AUTOREPLY_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  logBus.emitAutoReplyStatus(getAutoReplyStatus());
  return { ...config };
}

export function readAutoReplyPrompt(): string {
  if (!fs.existsSync(AUTOREPLY_PROMPT_FILE)) {
    fs.writeFileSync(AUTOREPLY_PROMPT_FILE, DEFAULT_PROMPT, 'utf-8');
  }
  return fs.readFileSync(AUTOREPLY_PROMPT_FILE, 'utf-8');
}

export function saveAutoReplyPrompt(content: string): void {
  ensureDataDir();
  fs.writeFileSync(AUTOREPLY_PROMPT_FILE, content, 'utf-8');
}

export function getAutoReplyStatus() {
  return {
    enabled: config.enabled,
    aiConfigured: isAiConfigured(),
    processing,
    replyCount: getAutoReplyLog(1).length > 0 ? getAutoReplyLog(100).length : 0,
  };
}

function phoneFromChatId(chatId: string): string {
  return chatId.replace('@c.us', '').replace('@lid', '').replace('@g.us', '');
}

function pushHistory(
  chatId: string,
  userText: string,
  assistantText: string
): void {
  const history = chatHistory.get(chatId) ?? [];
  history.push({ role: 'user', content: userText });
  history.push({ role: 'assistant', content: assistantText });
  const maxPairs = config.maxHistoryMessages;
  while (history.length > maxPairs) {
    history.shift();
  }
  chatHistory.set(chatId, history);
}

async function handleIncomingMessage(msg: IncomingMessage): Promise<void> {
  if (!config.enabled) return;
  if (!isAiConfigured()) return;
  if (isBulkSending?.()) return;
  if (!msg.body?.trim()) return;
  if (msg.fromMe) return;
  if (msg.isGroup && !config.replyInGroups) return;

  const client = getClient?.();
  if (!client) return;

  if (msg.messageId) {
    if (seenMessageIds.has(msg.messageId)) return;
    if (wasMessageHandled(msg.messageId)) return;
    seenMessageIds.add(msg.messageId);
    if (seenMessageIds.size > 5000) {
      const first = seenMessageIds.values().next().value;
      if (first) seenMessageIds.delete(first);
    }
  }

  const phoneKey = phoneFromChatId(msg.chatId);
  if (isOptedOut(`${phoneKey}@c.us`) || isOptedOut(msg.chatId)) {
    log(`Auto-reply omitido: ${phoneKey} en lista Habeas Data`, 'skip');
    return;
  }

  const now = Date.now();
  const lastAt = lastReplyAt.get(msg.chatId) ?? 0;
  if (now - lastAt < config.cooldownSeconds * 1000) {
    return;
  }

  if (processing) return;
  processing = true;
  logBus.emitAutoReplyStatus(getAutoReplyStatus());

  const displayPhone = phoneKey;
  log(`💬 Mensaje entrante de ${displayPhone}: ${msg.body.slice(0, 80)}`, 'info');

  try {
    const systemPrompt = readAutoReplyPrompt();
    const history = chatHistory.get(msg.chatId) ?? [];
    const senderContext = msg.senderName
      ? `\n\nEl contacto se llama ${msg.senderName}.`
      : '';
    const aiResult = await generateAiReply(
      systemPrompt + senderContext,
      history,
      msg.body
    );

    await client.sendText(msg.chatId, aiResult.text);
    pushHistory(msg.chatId, msg.body, aiResult.text);
    lastReplyAt.set(msg.chatId, Date.now());

    insertAutoReplyLog({
      chatId: msg.chatId,
      phone: displayPhone,
      senderName: msg.senderName,
      incoming: msg.body,
      reply: aiResult.text,
      messageId: msg.messageId,
      model: aiResult.model,
    });

    log(`🤖 Respuesta IA enviada a ${displayPhone}`, 'success');
    logBus.emitAutoReply({
      phone: displayPhone,
      incoming: msg.body,
      reply: aiResult.text,
      senderName: msg.senderName,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Error auto-reply a ${displayPhone}: ${errorMessage}`, 'error');
    insertAutoReplyLog({
      chatId: msg.chatId,
      phone: displayPhone,
      senderName: msg.senderName,
      incoming: msg.body,
      reply: '',
      messageId: msg.messageId,
      model: '',
      error: errorMessage,
    });
  } finally {
    processing = false;
    logBus.emitAutoReplyStatus(getAutoReplyStatus());
  }
}

export function attachIncomingListener(client: WaClient): void {
  if (listenerAttached) return;
  client.onIncomingMessage((msg) => {
    void handleIncomingMessage(msg);
  });
  listenerAttached = true;
}

export function resetAutoReplyListener(): void {
  listenerAttached = false;
  processing = false;
  chatHistory.clear();
  lastReplyAt.clear();
  seenMessageIds.clear();
}

export function getRecentAutoReplies(limit = 50) {
  return getAutoReplyLog(limit);
}
