import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { Browser, BrowserContext, firefox, Page } from 'playwright';
import { HEADLESS, log } from './config';

const PROFILE_LOCKS = ['lock', '.parentlock', 'parent.lock'];

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const ready = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.setTimeout(1000);
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => resolve(false));
    });

    if (ready) return;
    await waitMs(500);
  }

  throw new Error(
    `Firefox no respondió en el puerto ${port} tras ${timeoutMs / 1000}s. ` +
      'Cierra otras ventanas de Firefox y borra sessions/bulk-sender'
  );
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

  const port = await getFreePort();
  const wsEndpoint = `ws://127.0.0.1:${port}/session`;

  const args = [
    `--remote-debugging-port=${port}`,
    '-profile',
    profileDir,
    '-no-remote',
  ];

  if (HEADLESS) {
    args.push('-headless');
  }

  args.push('about:blank');

  log(`Iniciando Firefox ESR (puerto ${port})...`, 'info');

  let firefoxProcess: ChildProcess | null = spawn(executablePath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MOZ_CRASHREPORTER_DISABLE: '1',
      MOZ_DISABLE_CONTENT_SANDBOX: '1',
    },
  });

  firefoxProcess.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) log(`[firefox] ${line}`, 'info');
  });

  firefoxProcess.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line && !line.includes('GLib-GIO-Message')) {
      log(`[firefox] ${line}`, 'info');
    }
  });

  const launchFailed = new Promise<never>((_, reject) => {
    firefoxProcess?.once('error', (err) => {
      reject(new Error(`No se pudo iniciar Firefox: ${err.message}`));
    });
    firefoxProcess?.once('exit', (code) => {
      if (code !== null && code !== 0) {
        reject(new Error(`Firefox terminó inesperadamente (código ${code})`));
      }
    });
  });

  await Promise.race([waitForPort(port, 60_000), launchFailed]);
  log('Firefox abierto. Conectando Playwright...', 'info');

  let browser: Browser;
  try {
    browser = await firefox.connect(wsEndpoint, { timeout: 60_000 });
  } catch (err) {
    firefoxProcess.kill('SIGTERM');
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Playwright no pudo conectar a Firefox: ${message}`);
  }

  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  await page.setViewportSize({ width: 1440, height: 900 });
  log('Firefox listo.', 'success');

  return {
    browser,
    context,
    page,
    close: async () => {
      try {
        await browser.close();
      } catch {
        // ignore
      }
      if (firefoxProcess && !firefoxProcess.killed) {
        firefoxProcess.kill('SIGTERM');
        await waitMs(1000);
        if (!firefoxProcess.killed) {
          firefoxProcess.kill('SIGKILL');
        }
      }
      firefoxProcess = null;
    },
  };
}
