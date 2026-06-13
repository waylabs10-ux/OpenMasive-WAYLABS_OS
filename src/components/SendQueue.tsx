"use client";

import { useMemo } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Square,
  Download,
  Settings2,
  Send,
  CheckCircle2,
  SkipForward,
  XCircle,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useCampaignStore } from "@/store/campaign";
import type {
  CampaignStatusResponse,
  SessionState,
  DedupeBy,
} from "@/lib/types";
import type { DedupStats } from "@/lib/deduplication";
import { formatDuration, formatTime } from "@/lib/utils";

interface SendQueueProps {
  session: SessionState | null;
  campaign: CampaignStatusResponse | null;
  dedup: DedupStats | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onDownloadSummary: () => void;
  busy?: boolean;
}

const EVENT_LABEL: Record<string, string> = {
  sent: "Enviado",
  skipped: "Saltado",
  failed: "Fallido",
  waiting: "Esperando",
  batch_pause: "Pausa de lote",
  campaign_start: "Campaña iniciada",
  campaign_completed: "Campaña completada",
  campaign_paused: "Campaña pausada",
  campaign_cancelled: "Campaña cancelada",
  campaign_blocked: "Campaña bloqueada",
  blocked_detected: "Bloqueo detectado",
  daily_limit_reached: "Límite diario alcanzado",
  resume: "Reanudada",
};

/** Configuración de envío, controles de campaña y progreso en tiempo real. */
export function SendQueue({
  session,
  campaign,
  dedup,
  onStart,
  onPause,
  onResume,
  onCancel,
  onDownloadSummary,
  busy,
}: SendQueueProps) {
  const { config, setConfig, contacts, messages } = useCampaignStore();

  const status = campaign?.status ?? "idle";
  const counters = useMemo(
    () =>
      campaign?.counters ?? {
        total: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        protected: 0,
      },
    [campaign]
  );

  const progress = useMemo(() => {
    const total = counters.total || 0;
    if (!total) return 0;
    return ((counters.sent + counters.skipped + counters.failed) / total) * 100;
  }, [counters]);

  const isRunning = status === "running";
  const isPaused = status === "paused";
  const isFinished =
    status === "completed" || status === "cancelled" || status === "blocked";

  const canStart =
    session?.status === "connected" &&
    contacts.length > 0 &&
    messages.length > 0 &&
    !isRunning &&
    !isPaused;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Send className="text-whatsapp" />
          Configuración y envío
          <StatusBadge status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Configuración */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label>Delay mín (ms)</Label>
            <Input
              type="number"
              min={5000}
              value={config.minDelay}
              disabled={isRunning || isPaused}
              onChange={(e) =>
                setConfig({ minDelay: Number(e.target.value) })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Delay máx (ms)</Label>
            <Input
              type="number"
              min={10000}
              value={config.maxDelay}
              disabled={isRunning || isPaused}
              onChange={(e) =>
                setConfig({ maxDelay: Number(e.target.value) })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Tamaño de lote</Label>
            <Input
              type="number"
              min={5}
              max={100}
              value={config.batchSize}
              disabled={isRunning || isPaused}
              onChange={(e) =>
                setConfig({ batchSize: Number(e.target.value) })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Evitar reenvíos</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              value={config.dedupeBy}
              disabled={isRunning || isPaused}
              onChange={(e) =>
                setConfig({ dedupeBy: e.target.value as DedupeBy })
              }
            >
              <option value="phone">Por número (nunca repetir)</option>
              <option value="message">Por mensaje</option>
            </select>
          </div>
        </div>

        {/* Preview de deduplicación */}
        {dedup && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/50 p-2 text-xs">
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              A enviar: <b className="text-whatsapp">{dedup.toSend}</b>
            </span>
            <span>·</span>
            <span>
              {config.dedupeBy === "phone" ? "Ya contactados" : "Duplicados"}:{" "}
              <b>{dedup.duplicates}</b>
            </span>
            <span>·</span>
            <span>
              Protegidos: <b className="text-amber-400">{dedup.protectedSkips}</b>
            </span>
          </div>
        )}

        {/* Controles */}
        <div className="flex flex-wrap gap-2">
          {!isRunning && !isPaused && (
            <Button onClick={onStart} disabled={!canStart || busy}>
              <Play /> Iniciar campaña
            </Button>
          )}
          {isRunning && (
            <Button variant="secondary" onClick={onPause} disabled={busy}>
              <Pause /> Pausar
            </Button>
          )}
          {isPaused && (
            <Button onClick={onResume} disabled={busy}>
              <RotateCcw /> Reanudar
            </Button>
          )}
          {(isRunning || isPaused) && (
            <Button variant="destructive" onClick={onCancel} disabled={busy}>
              <Square /> Cancelar
            </Button>
          )}
          {isFinished && counters.total > 0 && (
            <Button variant="outline" onClick={onDownloadSummary}>
              <Download /> Descargar resumen
            </Button>
          )}
        </div>

        {session?.status !== "connected" && (
          <p className="text-xs text-amber-400">
            Conecta WhatsApp para poder iniciar una campaña.
          </p>
        )}

        {/* Progreso */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {counters.sent + counters.skipped + counters.failed}/
              {counters.total}
            </span>
            {campaign && campaign.estimatedRemainingMs > 0 && (
              <span className="text-muted-foreground">
                ~{formatDuration(campaign.estimatedRemainingMs)} restantes
              </span>
            )}
          </div>
          <Progress value={progress} />
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <Counter
              icon={<CheckCircle2 className="h-4 w-4 text-whatsapp" />}
              label="Enviados"
              value={counters.sent}
            />
            <Counter
              icon={<SkipForward className="h-4 w-4 text-amber-400" />}
              label="Saltados"
              value={counters.skipped}
            />
            <Counter
              icon={<XCircle className="h-4 w-4 text-destructive" />}
              label="Fallidos"
              value={counters.failed}
            />
            <Counter
              icon={<ShieldCheck className="h-4 w-4 text-blue-400" />}
              label="Protegidos"
              value={counters.protected}
            />
          </div>
        </div>

        {/* Log en vivo */}
        <div>
          <Label className="mb-1 block">Log en vivo</Label>
          <div className="h-40 overflow-auto rounded-md border border-border bg-black/40 p-2 font-mono text-xs">
            {campaign?.events?.length ? (
              campaign.events.map((ev, i) => (
                <div key={i} className="flex gap-2 py-0.5">
                  <span className="text-muted-foreground">
                    {formatTime(ev.ts)}
                  </span>
                  <span className="text-foreground">
                    {EVENT_LABEL[ev.type] ?? ev.type}
                  </span>
                  {typeof ev.phone === "string" && (
                    <span className="text-whatsapp">+{ev.phone}</span>
                  )}
                  {typeof ev.reason === "string" && (
                    <span className="text-amber-400">({ev.reason})</span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">Sin eventos todavía.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Counter({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md bg-secondary/40 p-2">
      <div className="flex items-center justify-center gap-1">
        {icon}
        <span className="font-semibold">{value}</span>
      </div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "running"
      ? "default"
      : status === "blocked" || status === "cancelled"
        ? "destructive"
        : status === "paused" || status === "daily_limit_reached"
          ? "warning"
          : "secondary";
  const label: Record<string, string> = {
    idle: "Inactiva",
    running: "En curso",
    paused: "Pausada",
    completed: "Completada",
    cancelled: "Cancelada",
    blocked: "Bloqueada",
  };
  return (
    <Badge variant={variant} className="ml-auto">
      {label[status] ?? status}
    </Badge>
  );
}
