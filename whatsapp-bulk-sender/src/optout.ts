import { normalizePhone } from './csvLoader';

const optoutSet = new Set<string>();

function toKey(phone: string): string | null {
  if (phone.includes('@')) return phone;
  return normalizePhone(phone);
}

export function loadOptoutList(phones: string[]): void {
  optoutSet.clear();
  for (const raw of phones) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const key = toKey(trimmed);
    if (key) optoutSet.add(key);
  }
}

export function addOptoutPhone(raw: string, reason = 'Solicitud del titular'): boolean {
  const key = toKey(raw);
  if (!key) return false;
  optoutSet.add(key);
  return true;
}

export function removeOptoutPhone(raw: string): boolean {
  const key = toKey(raw);
  if (!key || !optoutSet.has(key)) return false;
  optoutSet.delete(key);
  return true;
}

export function isOptedOut(phone: string): boolean {
  return optoutSet.has(phone);
}

export function getOptoutList(): string[] {
  return Array.from(optoutSet).sort();
}

export function getOptoutCount(): number {
  return optoutSet.size;
}

export function readOptoutRaw(): string {
  const lines = ['# Lista de exclusión — Ley 1581 (un número por línea, formato 3XXXXXXXXX)'];
  for (const phone of getOptoutList()) {
    lines.push(phone.replace('@c.us', '').replace('@lid', ''));
  }
  return lines.join('\n') + '\n';
}

export function saveOptoutRaw(content: string): number {
  const phones = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  loadOptoutList(phones);
  return getOptoutCount();
}
