import fs from 'fs';
import path from 'path';
import { Browser, BrowserContext, firefox, Page } from 'playwright';
import { HEADLESS, log } from './config';
import { ensurePlaywrightFirefox } from './firefox';

export interface FirefoxLaunchResult {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function launchFirefox(profileDir: string): Promise<FirefoxLaunchResult> {
  fs.mkdirSync(profileDir, { recursive: true });

  const firefoxPath = ensurePlaywrightFirefox();
  const storageStatePath = path.join(profileDir, 'storage-state.json');
  const hasStorageState = fs.existsSync(storageStatePath);

  log(`Navegador: Firefox Playwright`, 'info');
  log(`Ruta: ${firefoxPath}`, 'info');

  if (hasStorageState) {
    log('Restaurando sesión guardada...', 'info');
  }

  const launchHeartbeat = setInterval(() => {
    log('Esperando que Firefox abra (máx 90s)...', 'info');
  }, 10_000);

  let browser: Browser;
  try {
    browser = await firefox.launch({
      headless: HEADLESS,
      timeout: 90_000,
    });
  } finally {
    clearInterval(launchHeartbeat);
  }

  log('Firefox lanzado correctamente.', 'success');

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'es-CO',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    ...(hasStorageState ? { storageState: storageStatePath } : {}),
  });

  const page = await context.newPage();
  log('Pestaña de Firefox lista.', 'success');

  return {
    browser,
    context,
    page,
    close: async () => {
      try {
        await context.storageState({ path: storageStatePath });
      } catch {
        // ignore
      }
      try {
        await browser.close();
      } catch {
        // ignore
      }
    },
  };
}
