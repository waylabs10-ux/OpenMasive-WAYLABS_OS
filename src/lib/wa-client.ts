import type {
  SessionState,
  Contact,
  Message,
  CampaignConfig,
  CampaignStatusResponse,
  SentRecord,
  BlockedNumber,
} from "./types";

/**
 * Cliente HTTP del lado del navegador hacia las API routes de Next.js, que a su
 * vez hacen de proxy/orquestador hacia el wa-server (puerto 3001).
 */

async function http<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error || JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const waClient = {
  // ─────────────────────────── Sesión ─────────────────────────────────────
  getSession: () => http<SessionState>("/api/session"),

  startSession: () =>
    http<SessionState>("/api/session", {
      method: "POST",
      body: JSON.stringify({ action: "start" }),
    }),

  disconnectSession: () =>
    http<SessionState>("/api/session", {
      method: "POST",
      body: JSON.stringify({ action: "disconnect" }),
    }),

  // ─────────────────────────── Campaña ────────────────────────────────────
  startCampaign: (payload: {
    contacts: Contact[];
    messages: Message[];
    config: CampaignConfig;
  }) =>
    http<CampaignStatusResponse>("/api/messages", {
      method: "POST",
      body: JSON.stringify({ action: "start", ...payload }),
    }),

  getCampaignStatus: () =>
    http<CampaignStatusResponse>("/api/messages?resource=status"),

  pauseCampaign: () =>
    http<CampaignStatusResponse>("/api/messages", {
      method: "POST",
      body: JSON.stringify({ action: "pause" }),
    }),

  resumeCampaign: () =>
    http<CampaignStatusResponse>("/api/messages", {
      method: "POST",
      body: JSON.stringify({ action: "resume" }),
    }),

  cancelCampaign: () =>
    http<CampaignStatusResponse>("/api/messages", {
      method: "POST",
      body: JSON.stringify({ action: "cancel" }),
    }),

  getSummary: () =>
    http<Record<string, unknown>>("/api/messages?resource=summary"),

  // ─────────────────────────── Datos ──────────────────────────────────────
  getSentLog: () => http<SentRecord[]>("/api/messages?resource=sent-log"),

  getBlocked: () => http<BlockedNumber[]>("/api/messages?resource=blocked"),

  excludeNumber: (number: string, excluded = true) =>
    http<BlockedNumber[]>("/api/messages", {
      method: "POST",
      body: JSON.stringify({ action: "exclude", number, excluded }),
    }),
};
