import { z } from "zod";

/**
 * Esquemas de validación Zod para entradas del usuario.
 */

export const ContactSchema = z
  .object({
    name: z.string().optional(),
    phone: z
      .string()
      .min(10, "Teléfono muy corto")
      .regex(/^\d+$/, "Solo números, sin + ni espacios"),
  })
  // Permite campos adicionales usables como variables en los mensajes.
  .passthrough();

export const MessageSchema = z.object({
  id: z.string().min(1, "El id es obligatorio"),
  text: z.string().min(1, "El texto no puede estar vacío").max(4096),
});

export const ContactsFileSchema = z.array(ContactSchema);
export const MessagesFileSchema = z.array(MessageSchema);

export const CampaignConfigSchema = z.object({
  minDelay: z.number().min(5000).default(8000),
  maxDelay: z.number().min(10000).default(25000),
  batchSize: z.number().min(5).max(100).default(30),
  messageSelection: z.enum(["random", "sequential", "single"]),
  selectedMessageId: z.string().optional(),
});

export type ContactInput = z.infer<typeof ContactSchema>;
export type MessageInput = z.infer<typeof MessageSchema>;
export type CampaignConfigInput = z.infer<typeof CampaignConfigSchema>;

/**
 * Parsea y valida un archivo JSON de contactos.
 * Devuelve los contactos válidos, los errores por índice y el conteo de
 * duplicados internos detectados (mismo phone repetido).
 */
export function parseContactsJson(raw: unknown) {
  const result = ContactsFileSchema.safeParse(raw);
  if (!result.success) {
    return {
      valid: [] as ContactInput[],
      errors: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
      duplicates: 0,
    };
  }

  const seen = new Set<string>();
  let duplicates = 0;
  const valid: ContactInput[] = [];

  for (const contact of result.data) {
    const phone = contact.phone.replace(/[^\d]/g, "");
    if (seen.has(phone)) {
      duplicates += 1;
      continue;
    }
    seen.add(phone);
    valid.push({ ...contact, phone });
  }

  return { valid, errors: [], duplicates };
}

/**
 * Parsea un archivo CSV de contactos.
 *
 * Es flexible a propósito porque los CSV reales son caóticos:
 *  - Detecta el separador (coma, punto y coma o tabulador).
 *  - Detecta (opcionalmente) una fila de cabecera con nombres de columna como
 *    "telefono/phone/numero/celular" y "nombre/name".
 *  - Si no hay cabecera, asume: primera columna = teléfono, segunda = nombre.
 *  - Normaliza el teléfono a solo dígitos y descarta filas inválidas en lugar
 *    de fallar todo el archivo.
 *
 * Devuelve los contactos válidos, cuántas filas se descartaron por inválidas y
 * cuántos duplicados internos (mismo teléfono) se omitieron.
 */
const PHONE_HEADERS = [
  "phone",
  "telefono",
  "teléfono",
  "numero",
  "número",
  "number",
  "celular",
  "movil",
  "móvil",
  "whatsapp",
  "tel",
];
const NAME_HEADERS = ["name", "nombre", "contacto", "contact", "cliente"];

function detectDelimiter(line: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const c of candidates) {
    const count = line.split(c).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((c) => c.trim());
}

export function parseContactsCsv(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { valid: [] as ContactInput[], invalid: 0, duplicates: 0 };
  }

  const delimiter = detectDelimiter(lines[0]);
  const firstCells = splitCsvLine(lines[0], delimiter).map((c) =>
    c.toLowerCase()
  );

  // ¿La primera fila es cabecera? Lo es si alguna celda coincide con un
  // encabezado conocido y ninguna celda parece un teléfono.
  const looksLikeHeader =
    firstCells.some(
      (c) => PHONE_HEADERS.includes(c) || NAME_HEADERS.includes(c)
    ) && !firstCells.some((c) => /\d{6,}/.test(c));

  let phoneIdx = 0;
  let nameIdx = 1;
  let startRow = 0;

  if (looksLikeHeader) {
    startRow = 1;
    const pIdx = firstCells.findIndex((c) => PHONE_HEADERS.includes(c));
    const nIdx = firstCells.findIndex((c) => NAME_HEADERS.includes(c));
    phoneIdx = pIdx >= 0 ? pIdx : 0;
    nameIdx = nIdx >= 0 ? nIdx : -1;
  }

  const seen = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  const valid: ContactInput[] = [];

  for (let i = startRow; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i], delimiter);
    const rawPhone = cells[phoneIdx] ?? "";
    const phone = rawPhone.replace(/[^\d]/g, "");
    const name =
      nameIdx >= 0 && cells[nameIdx] ? cells[nameIdx] : undefined;

    const candidate = name ? { phone, name } : { phone };
    const result = ContactSchema.safeParse(candidate);
    if (!result.success) {
      invalid += 1;
      continue;
    }
    if (seen.has(phone)) {
      duplicates += 1;
      continue;
    }
    seen.add(phone);
    valid.push(result.data as ContactInput);
  }

  return { valid, invalid, duplicates };
}

/** Parsea y valida un archivo JSON de mensajes (ids únicos). */
export function parseMessagesJson(raw: unknown) {
  const result = MessagesFileSchema.safeParse(raw);
  if (!result.success) {
    return {
      valid: [] as MessageInput[],
      errors: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
      duplicates: 0,
    };
  }

  const seen = new Set<string>();
  let duplicates = 0;
  const valid: MessageInput[] = [];
  for (const msg of result.data) {
    if (seen.has(msg.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(msg.id);
    valid.push(msg);
  }
  return { valid, errors: [], duplicates };
}
