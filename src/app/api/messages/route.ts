import { NextResponse } from "next/server";

/**
 * Orquestador de mensajería hacia el wa-server.
 *
 *  GET  /api/messages?resource=status|summary|sent-log|blocked
 *  POST /api/messages {action: start|pause|resume|cancel|exclude, ...}
 */

const WA_SERVER_URL = process.env.WA_SERVER_URL ?? "http://localhost:3001";

export const dynamic = "force-dynamic";

const GET_ENDPOINTS: Record<string, string> = {
  status: "/messages/campaign/status",
  summary: "/messages/campaign/summary",
  "sent-log": "/messages/sent-log",
  blocked: "/messages/blocked",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get("resource") ?? "status";
  const endpoint = GET_ENDPOINTS[resource] ?? GET_ENDPOINTS.status;

  try {
    const res = await fetch(`${WA_SERVER_URL}${endpoint}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo contactar el wa-server: ${(err as Error).message}` },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = body?.action as string | undefined;

  let endpoint = "/messages/campaign/status";
  let payload: unknown = undefined;
  const method = "POST";

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

  try {
    const res = await fetch(`${WA_SERVER_URL}${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo contactar el wa-server: ${(err as Error).message}` },
      { status: 502 }
    );
  }
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
  };
}
