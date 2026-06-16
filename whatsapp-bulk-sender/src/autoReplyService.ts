import fs from 'fs';
import path from 'path';
import { generateAiReply, isAiConfigured } from './aiService';
import {
  AUTOREPLY_CONFIG_FILE,
  AUTOREPLY_PROMPT_FILE,
  AI_API_URL,
  AI_MODEL,
  log,
} from './config';
import { logBus } from './logBus';
import { isOptedOut } from './optout';
import {
  getAutoReplyLog,
  insertAutoReplyLog,
  wasMessageHandled,
} from './tracker';
import { IncomingMessage, IncomingMessageHandler, WaClient } from './types';

export interface AutoReplyConfig {
  enabled: boolean;
  replyInGroups: boolean;
  cooldownSeconds: number;
  maxHistoryMessages: number;
}

const DEFAULT_CONFIG: AutoReplyConfig = {
  enabled: false,
  replyInGroups: false,
  cooldownSeconds: 15,
  maxHistoryMessages: 8,
};

const DEFAULT_PROMPT = `Eres el asistente virtual de VOTOMAP, plataforma de marketing político y digital de DRAN DIGITAL S.A.S en Colombia.

Responde siempre en español, de forma breve (máximo 3 párrafos cortos), amable y profesional.
Si no sabes algo con certeza, indica que un asesor humano dará seguimiento pronto.
Nunca inventes datos de campañas, encuestas ni promesas electorales.
Si alguien pide no ser contactado o dejar de recibir mensajes, confirma amablemente que será excluido de futuros envíos (Ley 1581 de 2012).
No uses markdown ni listas numeradas; escribe como un mensaje natural de WhatsApp.`;

let config: AutoReplyConfig = { ...DEFAULT_CONFIG };
let handlerRegistered = false;
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
  if (config.enabled) {
    log('Bot IA activado desde el panel.', 'success');
  }
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
    replyCount: getAutoReplyLog(50).length,
  };
}

export function logAutoReplyStartupHints(): void {
  if (!isAiConfigured()) {
    log(
      'Bot IA: sin API key. Agrega AI_API_KEY en .env (Groq: gsk_...) y reinicia npm run web',
      'error'
    );
    return;
  }
  log(`Bot IA: API configurada (${AI_MODEL} · ${AI_API_URL})`, 'info');
  if (!config.enabled) {
    log('Bot IA: desactivado. Márcalo en el panel y pulsa "Guardar bot IA".', 'skip');
  } else {
    log('Bot IA: activo y escuchando mensajes entrantes.', 'success');
  }
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

function skipReply(reason: string): void {
  log(`Bot IA omitido: ${reason}`, 'skip');
}

async function handleIncomingMessage(msg: IncomingMessage): Promise<void> {
  const displayPhone = phoneFromChatId(msg.chatId);
  const preview = msg.body?.slice(0, 60) || '(sin texto)';

  log(`📩 Mensaje entrante de ${displayPhone}: ${preview}`, 'info');

  if (!config.enabled) {
    skipReply('bot desactivado en el panel');
    return;
  }
  if (!isAiConfigured()) {
    skipReply('falta AI_API_KEY en .env (reinicia npm run web después de guardar)');
    return;
  }
  if (isBulkSending?.()) {
    skipReply('hay un envío masivo en curso');
    return;
  }
  if (!msg.body?.trim()) {
    skipReply('mensaje sin texto (solo responde texto)');
    return;
  }
  if (msg.fromMe) {
    return;
  }
  if (msg.isGroup && !config.replyInGroups) {
    skipReply('mensaje de grupo (activa "Responder en grupos" si lo necesitas)');
    return;
  }

  const client = getClient?.();
  if (!client) {
    skipReply('WhatsApp no conectado');
    return;
  }

  if (msg.messageId) {
    if (seenMessageIds.has(msg.messageId)) return;
    if (wasMessageHandled(msg.messageId)) return;
    seenMessageIds.add(msg.messageId);
    if (seenMessageIds.size > 5000) {
      const first = seenMessageIds.values().next().value;
      if (first) seenMessageIds.delete(first);
    }
  }

  if (isOptedOut(`${displayPhone}@c.us`) || isOptedOut(msg.chatId)) {
    skipReply(`${displayPhone} está en lista Habeas Data`);
    return;
  }

  const now = Date.now();
  const lastAt = lastReplyAt.get(msg.chatId) ?? 0;
  const cooldownMs = config.cooldownSeconds * 1000;
  if (now - lastAt < cooldownMs) {
    skipReply(`espera ${config.cooldownSeconds}s entre respuestas al mismo chat`);
    return;
  }

  if (processing) {
    skipReply('ya hay otra respuesta en proceso');
    return;
  }

  processing = true;
  logBus.emitAutoReplyStatus(getAutoReplyStatus());

  try {
    const systemPrompt = readAutoReplyPrompt();
    const history = chatHistory.get(msg.chatId) ?? [];
    const senderContext = msg.senderName
      ? `\n\nEl contacto se llama ${msg.senderName}.`
      : '';
    log(`🤖 Generando respuesta IA para ${displayPhone}...`, 'info');

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

    log(`✅ Respuesta IA enviada a ${displayPhone}`, 'success');
    logBus.emitAutoReply({
      phone: displayPhone,
      incoming: msg.body,
      reply: aiResult.text,
      senderName: msg.senderName,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`❌ Error bot IA → ${displayPhone}: ${errorMessage}`, 'error');
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

const autoReplyHandler: IncomingMessageHandler = (msg) => {
  void handleIncomingMessage(msg);
};

export function registerAutoReplyHandler(
  handlers: Set<IncomingMessageHandler>
): void {
  handlers.add(autoReplyHandler);
  handlerRegistered = true;
}

export function attachIncomingListener(client: WaClient): void {
  if (handlerRegistered) return;
  client.onIncomingMessage(autoReplyHandler);
  handlerRegistered = true;
}

export function resetAutoReplyListener(): void {
  handlerRegistered = false;
  processing = false;
  chatHistory.clear();
  lastReplyAt.clear();
  seenMessageIds.clear();
}

export function getRecentAutoReplies(limit = 50) {
  return getAutoReplyLog(limit);
}
