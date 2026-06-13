"use client";

import { useMemo, useRef, useState } from "react";
import { MessageSquare, Upload, Trash2, AlertTriangle, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCampaignStore } from "@/store/campaign";
import { parseMessagesJson } from "@/lib/validations";
import { renderTemplate } from "@/lib/deduplication";
import type { Contact } from "@/lib/types";

const SAMPLE_CONTACT: Contact = {
  name: "María López",
  phone: "573009876543",
};

/** Carga y validación de mensajes con preview de variables en vivo. */
export function MessagesUploader() {
  const messages = useCampaignStore((s) => s.messages);
  const contacts = useCampaignStore((s) => s.contacts);
  const mergeMessages = useCampaignStore((s) => s.mergeMessages);
  const clearMessages = useCampaignStore((s) => s.clearMessages);

  const inputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  // Contacto de ejemplo para el preview: el primero cargado o uno ficticio.
  const sample = useMemo<Contact>(
    () => contacts[0] ?? SAMPLE_CONTACT,
    [contacts]
  );

  async function handleFile(file: File) {
    setFeedback(null);
    setErrors([]);
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const { valid, errors: validationErrors, duplicates } =
        parseMessagesJson(raw);

      if (validationErrors.length) {
        setErrors(
          validationErrors
            .slice(0, 5)
            .map((e) => `${e.path || "raíz"}: ${e.message}`)
        );
        return;
      }

      const { added, skipped } = mergeMessages(valid);
      setFeedback(
        `${added} mensajes añadidos · ${skipped + duplicates} duplicados omitidos`
      );
    } catch {
      setErrors(["El archivo no es un JSON válido."]);
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>
          <MessageSquare className="text-whatsapp" />
          Mensajes
          <Badge className="ml-auto">{messages.length} mensajes</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => inputRef.current?.click()}
          >
            <Upload />
            Cargar JSON
          </Button>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                clearMessages();
                setFeedback(null);
              }}
              title="Vaciar mensajes"
            >
              <Trash2 className="text-destructive" />
            </Button>
          )}
        </div>

        {feedback && <p className="text-xs text-whatsapp">{feedback}</p>}

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <div className="mb-1 flex items-center gap-1 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Errores de validación
            </div>
            <ul className="list-disc pl-4">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-1 flex-1 space-y-2 overflow-auto">
          {messages.length === 0 ? (
            <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              Variables disponibles:{" "}
              <code className="text-whatsapp">{"{name}"}</code>,{" "}
              <code className="text-whatsapp">{"{phone}"}</code> y cualquier
              campo del contacto.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className="rounded-md border border-border bg-secondary/40 p-2.5"
              >
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="secondary">{m.id}</Badge>
                </div>
                <p className="text-sm">{m.text}</p>
                <div className="mt-1.5 flex items-start gap-1 text-xs text-whatsapp">
                  <Eye className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{renderTemplate(m.text, sample)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
