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
  const waWebVersion = await resolveWaWebVersion();

  const { page, close } = await launchFirefox(sessionDir);
  await preparePage(page, waWebVersion);

  log('Cargando web.whatsapp.com...', 'info');
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
                chat: {
                  sendTextMessage: (
                    id: string,
                    msg: string,
                    options?: { waitForAck?: boolean }
                  ) => Promise<unknown>;
                };
              };
            }).WPP;

            const sendTimeout = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Envío sin respuesta de WhatsApp')), 40_000);
            });

            await Promise.race([
              wpp.chat.sendTextMessage(chatId, text, { waitForAck: true }),
              sendTimeout,
            ]);
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
