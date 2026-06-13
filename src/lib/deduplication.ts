import type {
  Contact,
  Message,
  SentRecord,
  BlockedNumber,
  DedupeBy,
} from "./types";

/**
 * Lógica de deduplicación del lado del cliente (para previews y estadísticas).
 * La fuente de verdad autoritativa vive en el servidor (`sent-log.json`), pero
 * estas utilidades permiten anticipar cuántos envíos se saltarán antes de
 * iniciar la campaña.
 */

export interface DedupStats {
  total: number;
  toSend: number;
  duplicates: number;
  protectedSkips: number;
}

/** Clave única de un envío: phone + messageId. */
export function sentKey(phone: string, messageId: string): string {
  return `${phone}::${messageId}`;
}

/** Conjunto de teléfonos protegidos (alcanzados por números bloqueados). */
export function buildProtectedSet(blocked: BlockedNumber[]): Set<string> {
  const set = new Set<string>();
  for (const b of blocked) {
    for (const phone of b.contactsReached || []) {
      set.add(phone);
    }
  }
  return set;
}

/**
 * Calcula estadísticas de deduplicación para un conjunto de contactos y
 * mensajes dado el registro de envíos y los números bloqueados.
 *
 * Nota: para la estimación, considera que cada contacto recibirá UN mensaje.
 */
export function computeDedupStats(
  contacts: Contact[],
  messages: Message[],
  sentLog: SentRecord[],
  blocked: BlockedNumber[],
  messageSelection: "random" | "sequential" | "single" = "random",
  selectedMessageId?: string,
  dedupeBy: DedupeBy = "phone"
): DedupStats {
  const protectedSet = buildProtectedSet(blocked);
  const sentSet = new Set(sentLog.map((r) => sentKey(r.phone, r.messageId)));
  const sentPhones = new Set(sentLog.map((r) => r.phone));

  let toSend = 0;
  let duplicates = 0;
  let protectedSkips = 0;

  contacts.forEach((contact, index) => {
    const message = pickMessageForPreview(
      messages,
      index,
      messageSelection,
      selectedMessageId
    );
    if (!message) return;

    if (protectedSet.has(contact.phone)) {
      protectedSkips += 1;
      return;
    }

    const alreadySent =
      dedupeBy === "phone"
        ? sentPhones.has(contact.phone)
        : sentSet.has(sentKey(contact.phone, message.id));

    if (alreadySent) {
      duplicates += 1;
      return;
    }
    toSend += 1;
  });

  return {
    total: contacts.length,
    toSend,
    duplicates,
    protectedSkips,
  };
}

/** Selección de mensaje equivalente a la del servidor (para previews). */
export function pickMessageForPreview(
  messages: Message[],
  index: number,
  selection: "random" | "sequential" | "single",
  selectedMessageId?: string
): Message | null {
  if (!messages.length) return null;
  switch (selection) {
    case "single":
      return messages.find((m) => m.id === selectedMessageId) ?? messages[0];
    case "sequential":
      return messages[index % messages.length];
    case "random":
    default:
      // Para el preview usamos el primero (determinista) en vez de aleatorio.
      return messages[0];
  }
}

/** Reemplaza variables {campo} con datos del contacto (preview en vivo). */
export function renderTemplate(template: string, contact: Contact): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = contact[key];
    return value !== undefined && value !== null ? String(value) : match;
  });
}
