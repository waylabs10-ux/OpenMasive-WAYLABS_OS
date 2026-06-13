"use client";

import { useState } from "react";
import { Ban, ChevronDown, ChevronRight, ShieldOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BlockedNumber } from "@/lib/types";
import { displayPhone, formatTime } from "@/lib/utils";

interface BlockedNumbersPanelProps {
  blocked: BlockedNumber[];
  onToggleExclude: (number: string, excluded: boolean) => void;
}

/** Panel de números bloqueados con historial de contactos alcanzados. */
export function BlockedNumbersPanel({
  blocked,
  onToggleExclude,
}: BlockedNumbersPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>
          <Ban className="text-destructive" />
          Números bloqueados
          <Badge
            variant={blocked.length ? "destructive" : "secondary"}
            className="ml-auto"
          >
            {blocked.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 overflow-auto">
        {blocked.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No hay números bloqueados. 🎉
          </p>
        ) : (
          blocked.map((b) => {
            const isOpen = expanded === b.number;
            return (
              <div
                key={b.number}
                className="rounded-md border border-destructive/30 bg-destructive/5"
              >
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  onClick={() => setExpanded(isOpen ? null : b.number)}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-destructive">
                        {displayPhone(b.number)}
                      </span>
                      {b.excludedManually && (
                        <Badge variant="warning">excluido</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(b.blockedAt)} · {b.messagesSent} mensajes ·{" "}
                      {b.contactsReached.length} contactos
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-destructive/20 px-3 py-2">
                    {b.reason && (
                      <p className="mb-2 text-xs text-muted-foreground">
                        Motivo: <span className="text-foreground">{b.reason}</span>
                      </p>
                    )}
                    <p className="mb-1 text-xs font-medium">
                      Contactos protegidos:
                    </p>
                    <div className="mb-2 flex max-h-28 flex-wrap gap-1 overflow-auto">
                      {b.contactsReached.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          Ninguno
                        </span>
                      ) : (
                        b.contactsReached.map((phone) => (
                          <Badge key={phone} variant="outline">
                            {displayPhone(phone)}
                          </Badge>
                        ))
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onToggleExclude(b.number, !b.excludedManually)
                      }
                    >
                      <ShieldOff />
                      {b.excludedManually
                        ? "Quitar exclusión"
                        : "Excluir de futuras campañas"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
