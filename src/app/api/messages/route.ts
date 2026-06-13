import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/wa-proxy";

/**
 * Orquestador de mensajería hacia el wa-server.
 *
 *  GET  /api/messages?resource=status|summary|sent-log|blocked
 *  POST /api/messages {action: start|pause|resume|cancel|exclude, ...}
 */

export const dynamic = "force-dynamic";

const GET_ENDPOINTS: Record<string, string> = {
  status: "/messages/campaign/status",
  summary: "/messages/campaign/summary",
  "sent-log": "/messages/sent-log",
  blocked: "/messages/blocked",
};

/** Respuestas degradadas por recurso, para que el polling no falle si el
 *  wa-server no está disponible. */
function degraded(resource: string) {
  switch (resource) {
    case "sent-log":
    case "blocked":
      return [];
    default:
      return {
        id: null,
        status: "idle",
        counters: { total: 0, sent: 0, skipped: 0, failed: 0, protected: 0 },
        cursor: 0,
        total: 0,
        sentToday: 0,
        startedAt: null,
        finishedAt: null,
        estimatedRemainingMs: 0,
        config: {},
        events: [],
      };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get("resource") ?? "status";
  const endpoint = GET_ENDPOINTS[resource] ?? GET_ENDPOINTS.status;

  const result = await proxyFetch(endpoint);
  if (result.ok && result.data != null) {
    return NextResponse.json(result.data, { status: 200 });
  }
  // Degradación silenciosa: la UI sigue operativa aunque el wa-server falle.
  return NextResponse.json(degraded(resource), { status: 200 });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = body?.action as string | undefined;

  let endpoint = "/messages/campaign/status";
  let payload: unknown = undefined;

  switch (action) {
    case "start":
      endpoint = "/messages/campaign/start";
      payload = {
        contacts: body.contacts,
        messages: body.messages,
        config: mapConfig(body.config),
      };
      break;
    case "pause":
      endpoint = "/messages/campaign/pause";
      break;
    case "resume":
      endpoint = "/messages/campaign/resume";
      break;
    case "cancel":
      endpoint = "/messages/campaign/cancel";
      break;
    case "exclude":
      endpoint = "/messages/blocked/exclude";
      payload = { number: body.number, excluded: body.excluded };
      break;
    default:
      return NextResponse.json(
        { error: `Acción no soportada: ${action}` },
        { status: 400 }
      );
  }

  const result = await proxyFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  if (result.data != null) {
    return NextResponse.json(result.data, { status: result.status });
  }
  return NextResponse.json(
    { error: result.error ?? "wa-server no disponible" },
    { status: result.status }
  );
}

/**
 * Mapea la config del frontend (minDelay/maxDelay) al formato que espera el
 * rate limiter del servidor (minDelayMs/maxDelayMs).
 */
function mapConfig(config: Record<string, unknown> | undefined) {
  if (!config) return undefined;
  return {
    minDelayMs: config.minDelay,
    maxDelayMs: config.maxDelay,
    batchSize: config.batchSize,
    messageSelection: config.messageSelection,
    selectedMessageId: config.selectedMessageId,
    dedupeBy: config.dedupeBy,
  };
}
