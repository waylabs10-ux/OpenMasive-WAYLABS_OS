import waVersion from '@wppconnect/wa-version';
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

const WHATSAPP_URL = 'https://web.whatsapp.com';
const WA_JS_PATH = require.resolve('@wppconnect/wa-js');

async function preparePage(page: Page, version: string): Promise<void> {
  await page.route('https://web.whatsapp.com/**', (route) => {
    if (route.request().url() === WHATSAPP_URL) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: waVersion.getPageContent(version),
      });
    }
    return route.continue();
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

    navigator.serviceWorker.register = () => Promise.reject(new Error('disabled'));

    setInterval(() => {
      window.onerror = console.error;
      window.onunhandledrejection = console.error;
      (window as unknown as { wppForceMainLoad?: boolean }).wppForceMainLoad = true;
    }, 500);
  });

  page.on('load', async () => {
    setTimeout(async () => {
      await page.addScriptTag({ path: WA_JS_PATH });
    }, 1000);
  });
}

async function waitForAuthentication(page: Page): Promise<void> {
  await page.exposeFunction('qrChanged', (qr: string) => {
    const code = qr.split(',')[0];
    log('Escanea este QR con WhatsApp → Dispositivos vinculados', 'info');
    qrcode.generate(code, { small: true });
  });

  const isRegistered = await page.evaluate(() => {
    return (window as unknown as { WPP?: { conn: { isRegistered: () => boolean | null } } }).WPP?.conn.isRegistered();
  });

  if (isRegistered === false) {
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
  }

  const authTimeout = AUTH_TIMEOUT === 0 ? 0 : AUTH_TIMEOUT * 1000;
  const qrTimeout = QR_TIMEOUT === 0 ? 0 : QR_TIMEOUT * 1000;
  const timeout = Math.max(authTimeout, qrTimeout);

  log('Esperando escaneo del QR en Firefox...', 'info');

  await page.waitForFunction(
    () => {
      const wpp = (window as unknown as { WPP?: { conn: { isRegistered: () => boolean | null } } }).WPP;
      return wpp?.conn.isRegistered() === true;
    },
    null,
    { timeout }
  );

  await page.waitForFunction(
    () => {
      const wpp = (window as unknown as { WPP?: { isReady?: boolean } }).WPP;
      return wpp?.isReady === true;
    },
    null,
    { timeout: 120_000 }
  );
}

export async function createFirefoxClient(): Promise<WaClient> {
  const firefoxPath = findFirefoxExecutable(FIREFOX_PATH);
  log(`Navegador: Firefox (${firefoxPath})`, 'info');

  const sessionDir = path.join(SESSION_DATA_PATH, SESSION_NAME);
  const waWebVersion = (await waVersion.fetchCurrentVersion()) ?? '2.3000.0';

  const context: BrowserContext = await firefox.launchPersistentContext(sessionDir, {
    headless: HEADLESS,
    executablePath: firefoxPath,
    viewport: { width: 1440, height: 900 },
    locale: 'es-CO',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await preparePage(page, waWebVersion);

  await page.goto(WHATSAPP_URL, {
    waitUntil: 'load',
    timeout: 0,
    referer: 'https://whatsapp.com/',
  });

  page.setDefaultTimeout(0);

  await page
    .waitForFunction(
      () => (window as unknown as { Debug?: { VERSION?: string } }).Debug?.VERSION,
      null,
      { timeout: 120_000 }
    )
    .catch(() => null);

  await page.waitForFunction(
    () => (window as unknown as { WPP?: { isReady?: boolean } }).WPP?.isReady,
    null,
    { timeout: 120_000 }
  );

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
