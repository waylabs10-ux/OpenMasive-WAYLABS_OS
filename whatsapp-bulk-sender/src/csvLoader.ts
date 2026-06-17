import fs from 'fs';
import Papa from 'papaparse';
import { CONTACTS_CSV, log } from './config';

export interface Contact {
  phone: string;
  name: string;
}

export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/[\s\-()]/g, '');

  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (/^3\d{9}$/.test(digits)) {
    digits = `57${digits}`;
  }

  if (!/^\d{10,13}$/.test(digits)) {
    return null;
  }

  return `${digits}@c.us`;
}

export function loadContacts(): Contact[] {
  if (!fs.existsSync(CONTACTS_CSV)) {
    throw new Error(`Archivo de contactos no encontrado: ${CONTACTS_CSV}`);
  }

  const csvContent = fs.readFileSync(CONTACTS_CSV, 'utf-8');
  const parsed = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  if (parsed.errors.length > 0) {
    log(`Errores al parsear CSV: ${parsed.errors[0].message}`, 'error');
  }

  const contacts: Contact[] = [];
  const seenPhones = new Set<string>();

  for (const row of parsed.data) {
    const rawPhone = row.phone?.trim();
    if (!rawPhone) continue;

    const phone = normalizePhone(rawPhone);
    if (!phone) {
      log(`Número inválido omitido: ${rawPhone}`, 'error');
      continue;
    }

    if (seenPhones.has(phone)) {
      log(`Contacto duplicado omitido: ${rawPhone}`, 'skip');
      continue;
    }
    seenPhones.add(phone);

    contacts.push({
      phone,
      name: row.name?.trim() ?? '',
    });
  }

  log(`${contacts.length} contactos cargados desde CSV`, 'info');
  return contacts;
}

export function readContactsCsvRaw(): string {
  if (!fs.existsSync(CONTACTS_CSV)) {
    return 'phone,name\n';
  }
  return fs.readFileSync(CONTACTS_CSV, 'utf-8');
}

export function saveContactsCsv(content: string): number {
  fs.writeFileSync(CONTACTS_CSV, content, 'utf-8');
  return loadContacts().length;
}
