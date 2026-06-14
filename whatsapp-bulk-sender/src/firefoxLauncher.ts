import fs from 'fs';
import path from 'path';
import { Browser, BrowserContext, firefox, Page } from 'playwright';
import { HEADLESS, log } from './config';

const PROFILE_LOCKS = ['lock', '.parentlock', 'parent.lock'];

export function cleanFirefoxProfileLocks(profileDir: string): void {
  for (const lockName of PROFILE_LOCKS) {
    const lockPath = path.join(profileDir, lockName);
    if (!fs.existsSync(lockPath)) continue;
    try {
      fs.unlinkSync(lockPath);
      log(`Lock de perfil eliminado: ${lockName}`, 'info');
    } catch {
      // ignore
    }
  }
}

export interface FirefoxLaunchResult {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function launchFirefoxEsr(
  executablePath: string,
  profileDir: string
): Promise<FirefoxLaunchResult> {
  fs.mkdirSync(profileDir, { recursive: true });
  cleanFirefoxProfileLocks(profileDir);

  const storageStatePath = path.join(profileDir, 'storage-state.json');
  const hasStorageState = fs.existsSync(storageStatePath);

  log('Lanzando Firefox con Playwright...', 'info');
  if (hasStorageState) {
    log('Restaurando sesión guardada...', 'info');
  }

  const launchHeartbeat = setInterval(() => {
    log('Esperando que Firefox abra (máx 90s)...', 'info');
  }, 10_000);

  let browser: Browser;
  try {
    browser = await firefox.launch({
      executablePath,
      headless: HEADLESS,
      timeout: 90_000,
      args: ['-no-remote'],
      firefoxUserPrefs: {
        'media.navigator.permission.disabled': true,
        'dom.webnotifications.enabled': false,
      },
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
        // ignore save errors
      }
      try {
        await browser.close();
      } catch {
        // ignore
      }
    },
  };
}
