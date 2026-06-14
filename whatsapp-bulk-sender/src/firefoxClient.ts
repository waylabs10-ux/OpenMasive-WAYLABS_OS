import {
  fetchCurrentVersion,
  getLatestVersion,
  getPageContent,
} from '@wppconnect/wa-version';
import { firefox, BrowserContext, Page } from 'playwright';
import qrcode from 'qrcode-terminal';
import path from 'path';
import {
  AUTH_TIMEOUT,
  FIREFOX_PATH,
  HEADLESS,
  log,
  QR_TIMEOUT,
  SESSION_DATA_PATH,
  SESSION_NAME,
} from './config';
import { findFirefoxExecutable } from './firefox';
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

  try {
    const online = await fetchCurrentVersion();
    if (online) {
      try {
        getPageContent(online);
        log(`Versión WhatsApp: ${online}`, 'info');
        return online;
      } catch {
        log(
          `Versión online ${online} no está en el paquete. Usando ${bundled}`,
          'info'
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`No se pudo consultar versión online: ${message}`, 'info');
  }

  log(`Versión WhatsApp local: ${bundled}`, 'info');
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
  const firefoxPath = findFirefoxExecutable(FIREFOX_PATH);
  log(`Navegador: Firefox (${firefoxPath})`, 'info');

  const sessionDir = path.join(SESSION_DATA_PATH, SESSION_NAME);
  const waWebVersion = await resolveWaWebVersion();

  log('Abriendo Firefox...', 'info');
  const context: BrowserContext = await firefox.launchPersistentContext(sessionDir, {
    headless: HEADLESS,
    executablePath: firefoxPath,
    viewport: { width: 1440, height: 900 },
    locale: 'es-CO',
    ignoreHTTPSErrors: true,
    firefoxUserPrefs: {
      'media.navigator.permission.disabled': true,
      'dom.webnotifications.enabled': false,
    },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  });

  const page = context.pages()[0] ?? (await context.newPage());
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

  log('Sesión de WhatsApp autenticada en Firefox.', 'success');

  return {
    async checkNumberStatus(phone: string): Promise<{ numberExists: boolean }> {
      const numberExists = await page.evaluate(async (chatId) => {
        const wpp = (window as unknown as {
          WPP: { contact: { queryExists: (id: string) => Promise<{ wid?: string } | null> } };
        }).WPP;
        const result = await wpp.contact.queryExists(chatId);
        return !!(result && result.wid);
      }, phone);
      return { numberExists };
    },

    async sendText(phone: string, message: string): Promise<void> {
      await page.evaluate(
        async ({ chatId, text }) => {
          const wpp = (window as unknown as {
            WPP: { chat: { sendTextMessage: (id: string, msg: string) => Promise<unknown> } };
          }).WPP;
          await wpp.chat.sendTextMessage(chatId, text);
        },
        { chatId: phone, text: message }
      );
    },

    async kill(): Promise<void> {
      await context.close();
    },
  };
}
