import { NextResponse } from "next/server";

/**
 * Proxy de sesión hacia el wa-server.
 *  GET  /api/session            → estado de la sesión
 *  POST /api/session {action}   → start | disconnect | reconnect
 */

const WA_SERVER_URL = process.env.WA_SERVER_URL ?? "http://localhost:3001";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${WA_SERVER_URL}/session/status`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      {
        status: "disconnected",
        qr: null,
        phoneNumber: null,
        lastError: `No se pudo contactar el wa-server: ${
          (err as Error).message
        }`,
        mock: false,
        startedAt: null,
      },
      { status: 200 }
    );
  }
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

  try {
    const res = await fetch(`${WA_SERVER_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
