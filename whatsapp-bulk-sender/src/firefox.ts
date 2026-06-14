import fs from 'fs';
import { execSync } from 'child_process';

const BLOCKED_BROWSERS = /chrome|chromium|google-chrome/i;

const LINUX_CANDIDATES = [
  '/usr/bin/firefox-esr',
  '/usr/bin/firefox',
  '/usr/lib/firefox-esr/firefox-esr',
  '/usr/lib/firefox/firefox',
  '/snap/bin/firefox',
];

export function assertFirefoxOnly(): void {
  if (process.env.USE_CHROME === 'true') {
    throw new Error(
      'Chrome/Chromium están deshabilitados. Este sistema solo funciona con Firefox.'
    );
  }

  const chromePath = process.env.CHROME_PATH ?? process.env.CHROMIUM_PATH;
  if (chromePath) {
    throw new Error(
      'CHROME_PATH/CHROMIUM_PATH no están permitidos. Usa FIREFOX_PATH si necesitas una ruta personalizada.'
    );
  }
}

function assertPathIsFirefox(executablePath: string): void {
  if (BLOCKED_BROWSERS.test(executablePath)) {
    throw new Error(
      `Ruta bloqueada (${executablePath}). Solo se permite Firefox.`
    );
  }
}

function tryWhich(command: string): string | null {
  try {
    const result = execSync(`which ${command}`, { encoding: 'utf-8' }).trim();
    return result || null;
  } catch {
    return null;
  }
}

export function findFirefoxExecutable(customPath?: string): string {
  assertFirefoxOnly();

  if (customPath) {
    if (!fs.existsSync(customPath)) {
      throw new Error(`Firefox no encontrado en FIREFOX_PATH: ${customPath}`);
    }
    assertPathIsFirefox(customPath);
    return customPath;
  }

  const fromWhich =
    tryWhich('firefox-esr') ?? tryWhich('firefox');
  if (fromWhich) {
    assertPathIsFirefox(fromWhich);
    return fromWhich;
  }

  for (const candidate of LINUX_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      assertPathIsFirefox(candidate);
      return candidate;
    }
  }

  throw new Error(
    'Firefox no encontrado. Instala Firefox ESR o define FIREFOX_PATH en .env\n' +
      'Ejemplo Parrot/Ubuntu: sudo apt install firefox-esr'
  );
}
