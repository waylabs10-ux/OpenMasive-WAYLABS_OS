import {
  getLatestVersion,
  getPageContent,
} from '@wppconnect/wa-version';
import { Page } from 'playwright';
import qrcode from 'qrcode-terminal';
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
import { PAGE_ACTION_TIMEOUT_MS, withTimeout } from './timeouts';
import { WaClient } from './types';

const WHATSAPP_URL = 'https://web.whatsapp.com/';
const WA_JS_PATH = require.resolve('@wppconnect/wa-js');

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

async function preparePage(page: Page): Promise<void> {
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

async function waitForAuthentication(page: Page): Promise<void> {
  await page.exposeFunction('qrChanged', (qr: string) => {
    const code = qr.split(',')[0];
    log('Escanea este QR con WhatsApp → Dispositivos vinculados', 'info');
    qrcode.generate(code, { small: true });
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

export async function createFirefoxClient(): Promise<WaClient> {
  ensurePlaywrightFirefox();

  const sessionDir = path.join(SESSION_DATA_PATH, SESSION_NAME);
  await resolveWaWebVersion();

  const { page, close } = await launchFirefox(sessionDir);
  await preparePage(page);

  log('Cargando web.whatsapp.com (versión en vivo)...', 'info');
  await page.goto(WHATSAPP_URL, {
    waitUntil: 'networkidle',
    timeout: 180_000,
    referer: 'https://whatsapp.com/',
  });

  await waitMs(1500);
  await injectWaJs(page);
  await waitForWppReady(page);
  await waitForAuthentication(page);
  await waitForMainReady(page);

  log('Sesión de WhatsApp autenticada en Firefox.', 'success');

  page.setDefaultTimeout(PAGE_ACTION_TIMEOUT_MS);

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

    async sendText(phone: string, message: string): Promise<void> {
      await withTimeout(
        page.evaluate(
          async ({ chatId, text }) => {
            const wpp = (window as unknown as {
              WPP: {
                contact: {
                  queryExists: (
                    id: string
                  ) => Promise<{ wid?: string | { _serialized?: string } } | null>;
                };
                chat: {
                  sendTextMessage: (
                    id: string,
                    msg: string,
                    options?: {
                      waitForAck?: boolean;
                      linkPreview?: boolean;
                      markIsRead?: boolean;
                      delay?: number;
                    }
                  ) => Promise<{ id?: string }>;
                };
              };
            }).WPP;

            let targetId = chatId;

            try {
              const lookup = await Promise.race([
                wpp.contact.queryExists(chatId),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
              ]);

              if (lookup?.wid) {
                targetId =
                  typeof lookup.wid === 'string'
                    ? lookup.wid
                    : lookup.wid._serialized ?? chatId;
              }
            } catch {
              // usar chatId original
            }

            const result = await wpp.chat.sendTextMessage(targetId, text, {
              waitForAck: false,
              linkPreview: false,
              markIsRead: false,
              delay: 1500,
            });

            if (!result?.id) {
              throw new Error('WhatsApp no confirmó el envío del mensaje');
            }

            return result.id;
          },
          { chatId: phone, text: message }
        ),
        PAGE_ACTION_TIMEOUT_MS,
        `Envío a ${phone}`
      );
    },

    async kill(): Promise<void> {
      await close();
    },
  };
}
