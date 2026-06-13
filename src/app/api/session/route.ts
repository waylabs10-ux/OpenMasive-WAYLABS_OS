import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/wa-proxy";

/**
 * Proxy de sesión hacia el wa-server.
 *  GET  /api/session            → estado de la sesión
 *  POST /api/session {action}   → start | disconnect | reconnect
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await proxyFetch("/session/status");
  if (result.ok && result.data) {
    return NextResponse.json(result.data, { status: 200 });
  }
  // Estado degradado: la UI sigue funcionando y muestra el motivo.
  return NextResponse.json(
    {
      status: "disconnected",
      qr: null,
      phoneNumber: null,
      lastError: result.error ?? "wa-server no disponible",
      mock: false,
      startedAt: null,
    },
    { status: 200 }
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = body?.action as string | undefined;

  const endpoint =
    action === "disconnect"
      ? "/session/disconnect"
      : action === "reconnect"
        ? "/session/reconnect"
        : "/session/start";

  const result = await proxyFetch(endpoint, { method: "POST" });
  if (result.ok && result.data) {
    return NextResponse.json(result.data, { status: result.status });
  }
  return NextResponse.json(
    { error: result.error ?? "wa-server no disponible" },
    { status: result.status }
  );
}
