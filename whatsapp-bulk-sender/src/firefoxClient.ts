import {
  getLatestVersion,
  getPageContent,
} from '@wppconnect/wa-version';
import { Page } from 'playwright';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'path';
import {
  AUTH_TIMEOUT,
  log,
  QR_TIMEOUT,
  SESSION_DATA_PATH,
  SESSION_NAME,
} from './config';
import { ensurePlaywrightFirefox } from './firefox';
import { launchFirefox } from './firefoxLauncher';
import { logBus } from './logBus';
import {
  MAX_SEND_ATTEMPTS,
  PAGE_ACTION_TIMEOUT_MS,
  POST_SEND_COOLDOWN_MS,
  withTimeout,
} from './timeouts';
import { SendResult, WaClient, IncomingMessage, IncomingMessageHandler } from './types';
import { registerAutoReplyHandler } from './autoReplyService';

const WHATSAPP_URL = 'https://web.whatsapp.com/';
const WA_JS_PATH = require.resolve('@wppconnect/wa-js');

let reattachIncomingBridge: (() => Promise<void>) | null = null;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBundledVersion(): string {
  const bundled = getLatestVersion();
  getPageContent(bundled);
  return bundled;
}

async function resolveWaWebVersion(): Promise<string> {
  const bundled = resolveBundledVersion();
  log(`Versión WhatsApp: ${bundled}`, 'info');
  return bundled;
}

async function preparePage(page: Page, version: string): Promise<void> {
  await page.route('https://web.whatsapp.com/**', async (route) => {
    const url = route.request().url().replace(/\/$/, '');
    if (url === WHATSAPP_URL.replace(/\/$/, '')) {
      try {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: getPageContent(version),
        });
        return;
      } catch {
        await route.continue();
        return;
      }
    }
    await route.continue();
  });

  await page.addInitScript(() => {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      })
      .catch(() => null);

    navigator.serviceWorker.register = () =>
      Promise.reject(new Error('service worker disabled'));

    setInterval(() => {
      window.onerror = console.error;
      window.onunhandledrejection = console.error;
      (window as unknown as { wppForceMainLoad?: boolean }).wppForceMainLoad = true;
    }, 500);
  });
}

async function injectWaJs(page: Page): Promise<void> {
  const alreadyInjected = await page.evaluate(() => {
    return Boolean((window as unknown as { WPP?: unknown }).WPP);
  });

  if (!alreadyInjected) {
    await page.addScriptTag({ path: WA_JS_PATH });
  }

  await page.waitForFunction(
    () => Boolean((window as unknown as { WPP?: { isReady?: boolean } }).WPP),
    null,
    { timeout: 90_000 }
  );
}

async function waitForWppReady(page: Page): Promise<void> {
  log('Cargando librería de WhatsApp (WPP)...', 'info');

  await page.waitForFunction(
    () => (window as unknown as { WPP?: { isReady?: boolean } }).WPP?.isReady === true,
    null,
    { timeout: 180_000 }
  );

  log('WhatsApp Web cargado correctamente.', 'success');
}

async function waitForMainReady(page: Page): Promise<void> {
  log('Sincronizando WhatsApp (espera que carguen tus chats)...', 'info');

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    log(`Sincronizando... (${elapsed}s)`, 'info');
  }, 15_000);

  try {
    await page.waitForFunction(
      () => {
        const wpp = (window as unknown as {
          WPP?: { conn?: { isMainReady?: () => boolean } };
        }).WPP;
        return wpp?.conn?.isMainReady?.() === true;
      },
      null,
      { timeout: 300_000 }
    );
  } finally {
    clearInterval(heartbeat);
  }

  log('WhatsApp sincronizado. Listo para enviar.', 'success');
}

async function ensureWppHealthy(page: Page): Promise<void> {
  const healthy = await page
    .evaluate(() => {
      const wpp = (window as unknown as {
        WPP?: { isReady?: boolean; conn?: { isMainReady?: () => boolean } };
      }).WPP;
      return Boolean(wpp?.isReady && wpp.conn?.isMainReady?.());
    })
    .catch(() => false);

  if (!healthy) {
    await ensureWppSession(page);
  }
}

async function ensureWppSession(page: Page): Promise<void> {
  const healthy = await page
    .evaluate(() => {
      const wpp = (window as unknown as {
        WPP?: { isReady?: boolean; conn?: { isMainReady?: () => boolean } };
      }).WPP;
      return Boolean(wpp?.isReady && wpp.conn?.isMainReady?.());
    })
    .catch(() => false);

  if (healthy) return;

  log('Reconectando librería WPP tras recarga de WhatsApp...', 'info');
  await waitMs(2000);
  await injectWaJs(page);
  await waitForWppReady(page);
  await waitForMainReady(page);
  if (reattachIncomingBridge) {
    await reattachIncomingBridge();
    log('Listener de mensajes entrantes reactivado.', 'info');
  }
}

async function evaluateSend(
  page: Page,
  phone: string,
  message: string
): Promise<SendResult> {
  return page.evaluate(
    async ({ chatId, text }) => {
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));

      type WidLike = string | { _serialized?: string };

      const serializeWid = (wid?: WidLike | null): string => {
        if (!wid) return '';
        return typeof wid === 'string' ? wid : wid._serialized ?? '';
      };

      const wpp = (window as unknown as {
        WPP: {
          contact: {
            queryExists: (id: string) => Promise<{
              wid?: WidLike;
              lid?: WidLike;
              biz?: boolean;
            } | null>;
            getPnLidEntry: (id: string) => Promise<{
              lid?: { _serialized?: string };
              phoneNumber?: { _serialized?: string };
              contact?: { isBusiness?: boolean };
            }>;
          };
          chat: {
            find: (id: string) => Promise<unknown>;
            sendTextMessage: (
              id: string,
              msg: string,
              options?: {
                waitForAck?: boolean;
                linkPreview?: boolean;
                markIsRead?: boolean;
                delay?: number;
              }
            ) => Promise<{
              id?: string;
              ack?: number;
              to?: string;
            }>;
            getMessageById: (id: string) => Promise<{ id?: string; ack?: number }>;
          };
        };
      }).WPP;

      if (!wpp) {
        throw new Error('WPP no disponible en la página');
      }

      const resolveTarget = async (): Promise<{
        candidateIds: string[];
        isBusiness: boolean;
      }> => {
        const candidateIds: string[] = [];
        let isBusiness = false;

        const addCandidate = (id?: string | null) => {
          if (!id || candidateIds.includes(id)) return;
          candidateIds.push(id);
        };

        const lookup = await Promise.race([
          wpp.contact.queryExists(chatId).catch(() => null),
          new Promise<'timeout'>((resolve) =>
            setTimeout(() => resolve('timeout'), 20_000)
          ),
        ]);

        if (lookup !== 'timeout' && lookup) {
          const resolvedLid = serializeWid(lookup.lid);
          const resolvedWid = serializeWid(lookup.wid);
          addCandidate(resolvedLid);
          addCandidate(resolvedWid);
          isBusiness = Boolean(lookup.biz);
        }

        const entry = await Promise.race([
          wpp.contact.getPnLidEntry(chatId).catch(() => null),
          new Promise<'timeout'>((resolve) =>
            setTimeout(() => resolve('timeout'), 15_000)
          ),
        ]);

        if (entry !== 'timeout' && entry) {
          addCandidate(entry.lid?._serialized);
          addCandidate(entry.phoneNumber?._serialized);
          isBusiness = isBusiness || Boolean(entry.contact?.isBusiness);
        }

        addCandidate(chatId);

        const ordered = [
          ...candidateIds.filter((id) => id.endsWith('@lid')),
          ...candidateIds.filter((id) => !id.endsWith('@lid')),
        ];

        for (const id of ordered) {
          await wpp.chat.find(id).catch(() => null);
          await sleep(400);
        }

        return { candidateIds: ordered, isBusiness };
      };

      const isLidRelatedError = (error: unknown): boolean => {
        const message = String(
          error instanceof Error ? error.message : error
        ).toLowerCase();
        return (
          message.includes('lid is missing') ||
          message.includes('missing in chat table') ||
          message.includes('no lid for user') ||
          message.includes('no lid') ||
          message.includes('account lid not provided') ||
          message.includes('remote id is not same') ||
          message.includes('invariant')
        );
      };

      const sendWithAck = async (targetId: string) => {
        const ackTimeout = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('WhatsApp no confirmó el envío (sin ACK)')),
            60_000
          );
        });

        return Promise.race([
          wpp.chat.sendTextMessage(targetId, text, {
            waitForAck: true,
            linkPreview: false,
            markIsRead: false,
            delay: 1200,
          }),
          ackTimeout,
        ]);
      };

      const { candidateIds, isBusiness } = await resolveTarget();
      let activeTargetId = candidateIds[0] ?? chatId;

      await sleep(800);

      let result: {
        id?: string;
        ack?: number;
        to?: string;
      } | undefined;
      let lastError: unknown = null;

      for (const targetId of candidateIds) {
        try {
          result = await sendWithAck(targetId);
          activeTargetId = targetId;
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if (!isLidRelatedError(err)) {
            throw err;
          }
          await wpp.chat.find(targetId).catch(() => null);
          await sleep(500);
        }
      }

      if (!result) {
        throw lastError instanceof Error
          ? lastError
          : new Error('No se pudo enviar: contacto sin LID válido en WhatsApp');
      }

      if (!result?.id) {
        throw new Error('WhatsApp no devolvió ID de mensaje');
      }

      let ack = result.ack ?? 0;
      if (ack < 1) {
        for (let attempt = 0; attempt < 20; attempt++) {
          await sleep(1000);
          const stored = await wpp.chat.getMessageById(result.id).catch(() => null);
          ack = stored?.ack ?? result.ack ?? 0;
          if (ack >= 1) break;
        }
      }

      if (ack < 1) {
        throw new Error(`WhatsApp no confirmó el envío (ack=${ack})`);
      }

      let storedAck = ack;
      for (let attempt = 0; attempt < 5; attempt++) {
        const stored = await wpp.chat.getMessageById(result.id).catch(() => null);
        if (stored?.id) {
          storedAck = stored.ack ?? ack;
          return {
            messageId: result.id,
            ack: storedAck,
            to: result.to ?? activeTargetId,
            isBusiness,
            resolvedId: activeTargetId,
          };
        }
        await sleep(800);
      }

      return {
        messageId: result.id,
        ack: storedAck,
        to: result.to ?? activeTargetId,
        isBusiness,
        resolvedId: activeTargetId,
      };
    },
    { chatId: phone, text: message }
  );
}

function isRecoverableSendError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('execution context was destroyed') ||
    lower.includes('wpp no disponible') ||
    lower.includes('wpp is undefined') ||
    lower.includes("can't access property") ||
    lower.includes('sin ack') ||
    lower.includes('no confirmó el envío') ||
    lower.includes('no devolvió id') ||
    lower.includes('no apareció en el chat') ||
    lower.includes('tiempo agotado') ||
    lower.includes('lid is missing') ||
    lower.includes('missing in chat table') ||
    lower.includes('no lid for user') ||
    lower.includes('no lid') ||
    lower.includes('account lid not provided')
  );
}

async function waitForAuthentication(page: Page): Promise<void> {
  await page.exposeFunction('qrChanged', async (qr: string) => {
    const code = qr.split(',')[0];
    log('Escanea este QR con WhatsApp → Dispositivos vinculados', 'info');
    qrcode.generate(code, { small: true });
    try {
      const dataUrl = await QRCode.toDataURL(code, { margin: 1, width: 280 });
      logBus.emitQr(dataUrl);
    } catch {
      // terminal QR sigue disponible
    }
  });

  const isRegistered = await page.evaluate(() => {
    return (window as unknown as { WPP?: { conn: { isRegistered: () => boolean | null } } })
      .WPP?.conn.isRegistered();
  });

  if (isRegistered === true) {
    log('Sesión ya autenticada en Firefox.', 'success');
    return;
  }

  await page.evaluate(() => {
    const wpp = (window as unknown as {
      WPP: { on: (event: string, cb: (auth: { fullCode: string }) => void) => void };
      qrChanged: (qr: string) => void;
    }).WPP;

    wpp.on('conn.auth_code_change', (auth) => {
      (window as unknown as { qrChanged: (qr: string) => void }).qrChanged(
        auth.fullCode + ',1'
      );
    });
  });

  const timeoutMs =
    QR_TIMEOUT === 0 && AUTH_TIMEOUT === 0
      ? 0
      : Math.max(QR_TIMEOUT, AUTH_TIMEOUT) * 1000;

  log('Esperando escaneo del QR en Firefox...', 'info');
  log('Si no ves QR: abre la ventana de Firefox y escanéalo ahí.', 'info');

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    log(`Aún esperando QR... (${elapsed}s)`, 'info');
  }, 15_000);

  try {
    await page.waitForFunction(
      () => {
        const wpp = (window as unknown as {
          WPP?: { conn: { isRegistered: () => boolean | null } };
        }).WPP;
        return wpp?.conn.isRegistered() === true;
      },
      null,
      { timeout: timeoutMs }
    );
  } finally {
    clearInterval(heartbeat);
  }
}

async function setupIncomingMessageBridge(
  page: Page,
  handlers: Set<IncomingMessageHandler>,
  force = false
): Promise<void> {
  await page.exposeFunction(
    'onIncomingMessage',
    (payload: IncomingMessage) => {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch {
          // ignore handler errors
        }
      }
    }
  ).catch(() => {
    // ya expuesto en sesión anterior
  });

  await page.evaluate((shouldForce) => {
    if (shouldForce) {
      (window as unknown as { __wppIncomingAttached?: boolean }).__wppIncomingAttached = false;
    }

    const wppRoot = (window as unknown as {
      WPP?: {
        on?: (event: string, cb: (msg: unknown) => void) => void;
        chat?: { on?: (event: string, cb: (msg: unknown) => void) => void };
      };
      onIncomingMessage: (payload: unknown) => void;
      __wppIncomingAttached?: boolean;
      __wppSeenIncoming?: Set<string>;
    }).WPP;

    if (!wppRoot) return;
    if ((window as unknown as { __wppIncomingAttached?: boolean }).__wppIncomingAttached) {
      return;
    }
    (window as unknown as { __wppIncomingAttached?: boolean }).__wppIncomingAttached = true;

    const seen = new Set<string>();
    (window as unknown as { __wppSeenIncoming?: Set<string> }).__wppSeenIncoming = seen;

    const serializeWid = (wid?: string | { _serialized?: string } | null): string => {
      if (!wid) return '';
      return typeof wid === 'string' ? wid : wid._serialized ?? '';
    };

    const SKIP_TYPES = new Set([
      'e2e_notification',
      'notification_template',
      'protocol',
      'gp2',
      'call_log',
      'revoked',
    ]);

    const handleRaw = (raw: unknown) => {
      const msg = raw as {
        id?: { fromMe?: boolean; _serialized?: string };
        from?: { _serialized?: string };
        to?: { _serialized?: string };
        chatId?: { _serialized?: string } | string;
        chat?: { id?: { _serialized?: string } };
        author?: { _serialized?: string };
        body?: string;
        notifyName?: string;
        isGroupMsg?: boolean;
        type?: string;
      };

      if (msg.id?.fromMe) return;

      const messageType = msg.type ?? 'chat';
      if (SKIP_TYPES.has(messageType)) return;

      const body = (msg.body ?? '').trim();
      if (!body) return;

      const isGroup = Boolean(msg.isGroupMsg);
      let chatId = '';

      if (isGroup) {
        chatId =
          serializeWid(msg.chatId) ||
          serializeWid(msg.chat?.id) ||
          serializeWid(msg.from);
      } else {
        chatId =
          serializeWid(msg.from) ||
          serializeWid(msg.chatId) ||
          serializeWid(msg.chat?.id) ||
          serializeWid(msg.to);
      }

      if (!chatId || chatId.includes('@broadcast') || chatId.includes('@newsletter')) {
        return;
      }

      const messageId = msg.id?._serialized;
      if (messageId) {
        if (seen.has(messageId)) return;
        seen.add(messageId);
        if (seen.size > 3000) {
          const first = seen.values().next().value;
          if (first) seen.delete(first);
        }
      }

      (window as unknown as { onIncomingMessage: (payload: unknown) => void }).onIncomingMessage({
        chatId,
        body,
        messageId,
        senderName: msg.notifyName,
        fromMe: false,
        isGroup,
      });
    };

    if (wppRoot.on) {
      wppRoot.on('chat.new_message', handleRaw);
    }
    if (wppRoot.chat?.on) {
      wppRoot.chat.on('chat.new_message', handleRaw);
    }
  }, force);
}

export async function createFirefoxClient(): Promise<WaClient> {
  ensurePlaywrightFirefox();

  const sessionDir = path.join(SESSION_DATA_PATH, SESSION_NAME);
  const waWebVersion = await resolveWaWebVersion();

  const { page, close } = await launchFirefox(sessionDir);
  await preparePage(page, waWebVersion);

  log('Cargando WhatsApp Web (HTML compatible con wa-js)...', 'info');
  await page.goto(WHATSAPP_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
    referer: 'https://whatsapp.com/',
  });

  await waitMs(1500);
  await injectWaJs(page);
  await waitForWppReady(page);
  await waitForAuthentication(page);
  await waitForMainReady(page);

  log('Sesión de WhatsApp autenticada en Firefox.', 'success');

  page.setDefaultTimeout(PAGE_ACTION_TIMEOUT_MS);

  const incomingHandlers = new Set<IncomingMessageHandler>();
  registerAutoReplyHandler(incomingHandlers);
  reattachIncomingBridge = async () => {
    await setupIncomingMessageBridge(page, incomingHandlers, true);
  };
  await setupIncomingMessageBridge(page, incomingHandlers);

  return {
    async waitUntilReady(): Promise<void> {
      const ready = await page.evaluate(() => {
        return (window as unknown as {
          WPP?: { conn?: { isMainReady?: () => boolean } };
        }).WPP?.conn?.isMainReady?.();
      });

      if (!ready) {
        await waitForMainReady(page);
      }
    },

    async sendText(phone: string, message: string): Promise<SendResult> {
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        try {
          if (attempt > 1) {
            log(`Reintento ${attempt}/${MAX_SEND_ATTEMPTS} para ${phone}...`, 'info');
          }

          await ensureWppHealthy(page);

          const result = await withTimeout(
            evaluateSend(page, phone, message),
            PAGE_ACTION_TIMEOUT_MS,
            `Envío a ${phone}`
          );

          await waitMs(POST_SEND_COOLDOWN_MS);
          return result;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const errorMessage = lastError.message;

          if (attempt >= MAX_SEND_ATTEMPTS || !isRecoverableSendError(errorMessage)) {
            throw lastError;
          }

          log(`Envío interrumpido para ${phone}, reconectando sesión...`, 'info');
          await waitMs(2000 * attempt);
          await ensureWppSession(page);
        }
      }

      throw lastError ?? new Error(`No se pudo enviar a ${phone}`);
    },

    onIncomingMessage(handler: IncomingMessageHandler): void {
      incomingHandlers.add(handler);
    },

    async kill(): Promise<void> {
      await close();
    },
  };
}
