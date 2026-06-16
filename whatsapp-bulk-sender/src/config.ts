import dotenv from 'dotenv';
import path from 'path';
import { logBus } from './logBus';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const DELAY_MIN_MS = parseInt(process.env.DELAY_MIN_MS ?? '8000', 10);
export const DELAY_MAX_MS = parseInt(process.env.DELAY_MAX_MS ?? '20000', 10);
export const SESSION_NAME = process.env.SESSION_NAME ?? 'bulk-sender-session';
export const DB_PATH = path.resolve(__dirname, '../data/sent.db');
export const CONTACTS_CSV = path.resolve(__dirname, '../data/contacts.csv');
export const MESSAGE_FILE = path.resolve(__dirname, '../data/message.txt');
export const SESSION_DATA_PATH = path.resolve(__dirname, '../sessions');
export const HEADLESS = process.env.HEADLESS === 'true';
export const FIREFOX_PATH = process.env.FIREFOX_PATH;
export const QR_TIMEOUT = parseInt(process.env.QR_TIMEOUT ?? '0', 10);
export const AUTH_TIMEOUT = parseInt(process.env.AUTH_TIMEOUT ?? '0', 10);
export const REPORTS_DIR = path.resolve(__dirname, '../data/reports');
export const OPTOUT_FILE = path.resolve(__dirname, '../data/optout.txt');
export const WEB_PORT = parseInt(process.env.WEB_PORT ?? '3847', 10);
export const AUTOREPLY_PROMPT_FILE = path.resolve(__dirname, '../data/autoreply-prompt.txt');
export const AUTOREPLY_CONFIG_FILE = path.resolve(__dirname, '../data/autoreply-config.json');

export const AI_API_KEY = process.env.OPENAI_API_KEY ?? process.env.AI_API_KEY ?? '';
const isGroqKey = AI_API_KEY.startsWith('gsk_');
export const AI_API_URL =
  process.env.AI_API_URL ??
  (isGroqKey
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions');
export const AI_MODEL =
  process.env.AI_MODEL ?? (isGroqKey ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');
export const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE ?? '0.7');
export const AI_MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS ?? '500', 10);

const COLORS = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
} as const;

export type LogType = 'success' | 'skip' | 'error' | 'info';

const LOG_COLORS: Record<LogType, string> = {
  success: COLORS.green,
  skip: COLORS.yellow,
  error: COLORS.red,
  info: COLORS.cyan,
};

export function log(message: string, type: LogType = 'info'): void {
  const now = new Date();
  const timestamp = now.toLocaleTimeString('es-CO', { hour12: false });
  console.log(`${LOG_COLORS[type]}[${timestamp}] ${message}${COLORS.reset}`);
  logBus.emitLog(message, type);
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export function formatMessage(template: string, name?: string): string {
  const displayName = name?.trim() || 'estimado/a';
  return template.replace(/\{name\}/g, displayName);
}

export function printBanner(): void {
  const cyan = COLORS.cyan;
  const dim = '\x1b[2m';
  const reset = COLORS.reset;
  const bold = '\x1b[1m';

  console.log('');
  console.log(`${cyan}${bold}  ██╗    ██╗ █████╗ ██╗   ██╗██╗      █████╗ ██████╗ ███████╗${reset}`);
  console.log(`${cyan}${bold}  ██║    ██║██╔══██╗╚██╗ ██╔╝██║     ██╔══██╗██╔══██╗██╔════╝${reset}`);
  console.log(`${cyan}${bold}  ██║ █╗ ██║███████║ ╚████╔╝ ██║     ███████║██████╔╝███████╗${reset}`);
  console.log(`${cyan}${bold}  ██║███╗██║██╔══██║  ╚██╔╝  ██║     ██╔══██║██╔══██╗╚════██║${reset}`);
  console.log(`${cyan}${bold}  ╚███╔███╔╝██║  ██║   ██║   ███████╗██║  ██║██████╔╝███████║${reset}`);
  console.log(`${cyan}${bold}   ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝${reset}`);
  console.log(`${cyan}${bold}                        OS${reset}`);
  console.log('');
  console.log(`${cyan}  WhatsApp Bulk Sender${reset}  ${dim}· Firefox · Playwright · TypeScript${reset}`);
  console.log(`${dim}  DRANDIGITAL S.a.s${reset}`);
  console.log(`${dim}  github.com/waylabs10-ux/whatsapp-bulk-sender${reset}`);
  console.log('');
}
