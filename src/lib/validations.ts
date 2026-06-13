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
