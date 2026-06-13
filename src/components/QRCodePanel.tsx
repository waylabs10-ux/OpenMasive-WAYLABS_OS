"use client";

import { QRCodeSVG } from "qrcode.react";
import { Loader2, LogOut, RefreshCw, ShieldAlert, Smartphone } from "lucide-react";
import type { SessionState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { displayPhone } from "@/lib/utils";

interface QRCodePanelProps {
  session: SessionState | null;
  onStart: () => void;
  onDisconnect: () => void;
  loading?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  disconnected: "Desconectado",
  qr_ready: "Escanea el QR",
  connecting: "Conectando…",
  connected: "Conectado",
  blocked: "Bloqueado",
};

/** Panel de escaneo del QR y estado de la sesión de WhatsApp. */
export function QRCodePanel({
  session,
  onStart,
  onDisconnect,
  loading,
}: QRCodePanelProps) {
  const status = session?.status ?? "disconnected";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Smartphone className="text-whatsapp" />
          Sesión de WhatsApp
          {session?.mock && (
            <Badge variant="warning" className="ml-auto">
              modo simulado
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <StatusIndicator status={status} phone={session?.phoneNumber} />

        {status === "qr_ready" && session?.qr && (
          <div className="rounded-xl bg-white p-4">
            <QRCodeSVG value={session.qr} size={220} level="M" />
          </div>
        )}

        {status === "connecting" && (
          <div className="flex h-[252px] w-[252px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border">
            <Loader2 className="h-10 w-10 animate-spin text-whatsapp" />
            <p className="text-sm text-muted-foreground">
              Estableciendo conexión…
            </p>
          </div>
        )}

        {status === "connected" && (
          <div className="flex h-[252px] w-[252px] flex-col items-center justify-center gap-3 rounded-xl border border-whatsapp/40 bg-whatsapp/5">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-whatsapp/20 animate-pulse-ring">
              <Smartphone className="h-8 w-8 text-whatsapp" />
            </div>
            <p className="font-semibold text-whatsapp">
              {displayPhone(session?.phoneNumber ?? "")}
            </p>
          </div>
        )}

        {status === "blocked" && (
          <div className="flex h-[252px] w-[252px] flex-col items-center justify-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5">
            <ShieldAlert className="h-12 w-12 text-destructive" />
            <p className="px-4 text-center text-sm text-destructive">
              Número bloqueado por WhatsApp
            </p>
          </div>
        )}

        {(status === "disconnected" || status === "qr_ready") && (
          <Button onClick={onStart} disabled={loading} className="w-full">
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {status === "qr_ready" ? "Regenerar QR" : "Iniciar sesión"}
          </Button>
        )}

        {(status === "connected" ||
          status === "connecting" ||
          status === "blocked") && (
          <Button
            variant="destructive"
            onClick={onDisconnect}
            disabled={loading}
            className="w-full"
          >
            <LogOut />
            Cerrar sesión
          </Button>
        )}

        {session?.lastError && (
          <p className="text-xs text-destructive">{session.lastError}</p>
        )}
      </CardContent>
    </Card>
  );
}

function StatusIndicator({
  status,
  phone,
}: {
  status: string;
  phone?: string | null;
}) {
  const color =
    status === "connected"
      ? "bg-whatsapp"
      : status === "blocked"
        ? "bg-destructive"
        : status === "connecting" || status === "qr_ready"
          ? "bg-amber-400"
          : "bg-muted-foreground";

  return (
    <div className="flex w-full items-center justify-between rounded-lg bg-secondary/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
        <span className="text-sm font-medium">
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>
      {status === "connected" && phone && (
        <span className="text-xs text-muted-foreground">
          {displayPhone(phone)}
        </span>
      )}
    </div>
  );
}
