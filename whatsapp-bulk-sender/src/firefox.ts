import fs from 'fs';
import { firefox } from 'playwright';

const BLOCKED_BROWSERS = /chrome|chromium|google-chrome/i;

export function assertFirefoxOnly(): void {
  if (process.env.USE_CHROME === 'true') {
    throw new Error(
      'Chrome/Chromium están deshabilitados. Este sistema solo funciona con Firefox.'
    );
  }

  const chromePath = process.env.CHROME_PATH ?? process.env.CHROMIUM_PATH;
  if (chromePath) {
    throw new Error(
      'CHROME_PATH/CHROMIUM_PATH no están permitidos. Este sistema usa Firefox de Playwright.'
    );
  }
}

export function ensurePlaywrightFirefox(): string {
  assertFirefoxOnly();

  if (process.env.FIREFOX_PATH) {
    logFirefoxPathWarning();
  }

  const executablePath = firefox.executablePath();
  if (!fs.existsSync(executablePath)) {
    throw new Error(
      'Firefox de Playwright no está instalado.\n' +
        'Ejecuta: npx playwright install firefox\n' +
        'O desde el proyecto: npm run setup'
    );
  }

  if (BLOCKED_BROWSERS.test(executablePath)) {
    throw new Error(
      `Ruta bloqueada (${executablePath}). Solo se permite Firefox de Playwright.`
    );
  }

  return executablePath;
}

function logFirefoxPathWarning(): void {
  console.log(
    '\x1b[33m[aviso] FIREFOX_PATH se ignora. Playwright requiere su propio Firefox ' +
      '(no funciona con firefox-esr del sistema). Ejecuta: npx playwright install firefox\x1b[0m'
  );
}
