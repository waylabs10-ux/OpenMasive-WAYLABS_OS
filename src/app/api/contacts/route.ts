import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/wa-proxy";
import type { SentRecord, BlockedNumber } from "@/lib/types";

/**
 * Devuelve los datos necesarios para calcular la deduplicación en el cliente:
 * el registro de envíos y los números bloqueados (con sus contactos protegidos).
 *
 *  GET /api/contacts → { sentLog, blocked }
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const [sent, blocked] = await Promise.all([
    proxyFetch<SentRecord[]>("/messages/sent-log"),
    proxyFetch<BlockedNumber[]>("/messages/blocked"),
  ]);

  return NextResponse.json({
    sentLog: Array.isArray(sent.data) ? sent.data : [],
    blocked: Array.isArray(blocked.data) ? blocked.data : [],
    error: sent.error ?? blocked.error,
  });
}
