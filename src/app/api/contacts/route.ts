import { NextResponse } from "next/server";

/**
 * Devuelve los datos necesarios para calcular la deduplicación en el cliente:
 * el registro de envíos y los números bloqueados (con sus contactos protegidos).
 *
 *  GET /api/contacts → { sentLog, blocked }
 */

const WA_SERVER_URL = process.env.WA_SERVER_URL ?? "http://localhost:3001";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [sentRes, blockedRes] = await Promise.all([
      fetch(`${WA_SERVER_URL}/messages/sent-log`, { cache: "no-store" }),
      fetch(`${WA_SERVER_URL}/messages/blocked`, { cache: "no-store" }),
    ]);
    const sentLog = await sentRes.json().catch(() => []);
    const blocked = await blockedRes.json().catch(() => []);
    return NextResponse.json({ sentLog, blocked });
  } catch (err) {
    return NextResponse.json(
      {
        sentLog: [],
        blocked: [],
        error: `No se pudo contactar el wa-server: ${(err as Error).message}`,
      },
      { status: 200 }
    );
  }
}
