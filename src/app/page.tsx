"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircleMore, ShieldAlert } from "lucide-react";
import { QRCodePanel } from "@/components/QRCodePanel";
import { ContactsUploader } from "@/components/ContactsUploader";
import { MessagesUploader } from "@/components/MessagesUploader";
import { SendQueue } from "@/components/SendQueue";
import { SentLogTable } from "@/components/SentLogTable";
import { BlockedNumbersPanel } from "@/components/BlockedNumbersPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { waClient } from "@/lib/wa-client";
import { useCampaignStore } from "@/store/campaign";
import { computeDedupStats } from "@/lib/deduplication";
import type {
  SessionState,
  CampaignStatusResponse,
  SentRecord,
  BlockedNumber,
} from "@/lib/types";

export default function DashboardPage() {
  const { contacts, messages, config } = useCampaignStore();

  const [session, setSession] = useState<SessionState | null>(null);
  const [campaign, setCampaign] = useState<CampaignStatusResponse | null>(null);
  const [sentLog, setSentLog] = useState<SentRecord[]>([]);
  const [blocked, setBlocked] = useState<BlockedNumber[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Para evitar setState tras desmontar.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ─── Polling de sesión (cada 3s) ───
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const s = await waClient.getSession();
        if (active && mounted.current) setSession(s);
      } catch {
        /* el endpoint devuelve estado degradado en caso de error */
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // ─── Polling de campaña (cada 2s) ───
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const c = await waClient.getCampaignStatus();
        if (active && mounted.current) setCampaign(c);
      } catch {
        /* noop */
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // ─── Carga de registro y bloqueos (cada 4s) ───
  const refreshData = useCallback(async () => {
    try {
      const [log, blk] = await Promise.all([
        waClient.getSentLog(),
        waClient.getBlocked(),
      ]);
      if (mounted.current) {
        setSentLog(Array.isArray(log) ? log : []);
        setBlocked(Array.isArray(blk) ? blk : []);
      }
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    refreshData();
    const id = setInterval(refreshData, 4000);
    return () => clearInterval(id);
  }, [refreshData]);

  // ─── Estadísticas de deduplicación (preview) ───
  const dedup = useMemo(
    () =>
      computeDedupStats(
        contacts,
        messages,
        sentLog,
        blocked,
        config.messageSelection,
        config.selectedMessageId
      ),
    [contacts, messages, sentLog, blocked, config]
  );

  // ─── Handlers ───
  const withBusy = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    []
  );

  const handleStartSession = () =>
    withBusy(async () => setSession(await waClient.startSession()));
  const handleDisconnect = () =>
    withBusy(async () => setSession(await waClient.disconnectSession()));

  const handleStartCampaign = () =>
    withBusy(async () => {
      const res = await waClient.startCampaign({ contacts, messages, config });
      setCampaign(res);
    });
  const handlePause = () =>
    withBusy(async () => setCampaign(await waClient.pauseCampaign()));
  const handleResume = () =>
    withBusy(async () => setCampaign(await waClient.resumeCampaign()));
  const handleCancel = () =>
    withBusy(async () => setCampaign(await waClient.cancelCampaign()));

  const handleToggleExclude = (number: string, excluded: boolean) =>
    withBusy(async () => {
      const res = await waClient.excludeNumber(number, excluded);
      setBlocked(Array.isArray(res) ? res : []);
    });

  const handleDownloadSummary = () =>
    withBusy(async () => {
      const summary = await waClient.getSummary();
      const blob = new Blob([JSON.stringify(summary, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campaña-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

  const showBlockedAlert =
    session?.status === "blocked" || campaign?.status === "blocked";

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <header className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-whatsapp/15">
          <MessageCircleMore className="h-6 w-6 text-whatsapp" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            OpenMasive — WhatsApp Bulk Sender
          </h1>
          <p className="text-sm text-muted-foreground">
            Envío masivo con deduplicación y protección anti-bloqueo
          </p>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <ShieldAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {showBlockedAlert && (
        <Alert variant="destructive" className="mb-4">
          <ShieldAlert />
          <AlertTitle>¡Número bloqueado detectado!</AlertTitle>
          <AlertDescription>
            La campaña se pausó automáticamente. Los contactos alcanzados por
            este número quedaron protegidos y no se les enviará desde ningún
            número nuevo.
          </AlertDescription>
        </Alert>
      )}

      {/* Fila superior: sesión + uploaders */}
      <div className="grid gap-4 lg:grid-cols-3">
        <QRCodePanel
          session={session}
          onStart={handleStartSession}
          onDisconnect={handleDisconnect}
          loading={busy}
        />
        <ContactsUploader />
        <MessagesUploader />
      </div>

      {/* Envío */}
      <div className="mt-4">
        <SendQueue
          session={session}
          campaign={campaign}
          dedup={dedup}
          onStart={handleStartCampaign}
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
          onDownloadSummary={handleDownloadSummary}
          busy={busy}
        />
      </div>

      {/* Historial + bloqueados */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SentLogTable records={sentLog} />
        <BlockedNumbersPanel
          blocked={blocked}
          onToggleExclude={handleToggleExclude}
        />
      </div>

      <footer className="mt-8 text-center text-xs text-muted-foreground">
        OpenMasive-WAYLABS_OS · Usa esta herramienta de forma responsable y
        respeta las políticas de WhatsApp.
      </footer>
    </main>
  );
}
