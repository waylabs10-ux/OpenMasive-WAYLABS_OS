"use client";

import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SentRecord } from "@/lib/types";
import { displayPhone, formatTime } from "@/lib/utils";

interface SentLogTableProps {
  records: SentRecord[];
}

/** Historial de mensajes enviados (registro persistente). */
export function SentLogTable({ records }: SentLogTableProps) {
  const sorted = [...records].sort((a, b) =>
    b.sentAt.localeCompare(a.sentAt)
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>
          <History className="text-whatsapp" />
          Historial de envíos
          <Badge className="ml-auto">{records.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Aún no se han registrado envíos.
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-2 font-medium">Hora</th>
                <th className="py-1.5 pr-2 font-medium">Teléfono</th>
                <th className="py-1.5 pr-2 font-medium">Mensaje</th>
                <th className="py-1.5 font-medium">Enviado por</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 200).map((r, i) => (
                <tr
                  key={`${r.phone}-${r.messageId}-${i}`}
                  className="border-b border-border/50"
                >
                  <td className="py-1.5 pr-2 text-muted-foreground">
                    {formatTime(r.sentAt)}
                  </td>
                  <td className="py-1.5 pr-2 text-whatsapp">
                    {displayPhone(r.phone)}
                  </td>
                  <td className="py-1.5 pr-2">
                    <Badge variant="secondary">{r.messageId}</Badge>
                  </td>
                  <td className="py-1.5 text-muted-foreground">
                    {displayPhone(r.sentByNumber)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
