/**
 * Tipos compartidos del frontend.
 */

export type SessionStatus =
  | "disconnected"
  | "qr_ready"
  | "connecting"
  | "connected"
  | "blocked";

export interface SessionState {
  status: SessionStatus;
  qr: string | null;
  phoneNumber: string | null;
  lastError: string | null;
  mock: boolean;
  startedAt: string | null;
}

export interface Contact {
  name?: string;
  phone: string;
  /** Campos adicionales del contacto utilizables como variables {campo}. */
  [key: string]: unknown;
}

export interface Message {
  id: string;
  text: string;
}

export type MessageSelection = "random" | "sequential" | "single";

/**
 * Estrategia de deduplicación:
 *  - "phone": nunca se vuelve a enviar a un número ya contactado (por defecto).
 *  - "message": evita repetir exactamente el mismo phone + messageId.
 */
export type DedupeBy = "phone" | "message";

export interface CampaignConfig {
  minDelay: number;
  maxDelay: number;
  batchSize: number;
  messageSelection: MessageSelection;
  selectedMessageId?: string;
  dedupeBy: DedupeBy;
}

export interface SentRecord {
  phone: string;
  messageId: string;
  sentAt: string;
  sentByNumber: string;
  waMessageId?: string | null;
}

export interface BlockedNumber {
  number: string;
  blockedAt: string;
  messagesSent: number;
  contactsReached: string[];
  reason?: string;
  excludedManually?: boolean;
}

export type CampaignStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "blocked";

export interface CampaignCounters {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  protected: number;
}

export interface CampaignEvent {
  ts: string;
  type: string;
  [key: string]: unknown;
}

export interface CampaignStatusResponse {
  id: string | null;
  status: CampaignStatus;
  counters: CampaignCounters;
  cursor: number;
  total: number;
  sentToday: number;
  startedAt: string | null;
  finishedAt: string | null;
  estimatedRemainingMs: number;
  config: Record<string, unknown>;
  events: CampaignEvent[];
}
