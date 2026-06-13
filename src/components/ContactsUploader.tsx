"use client";

import { useRef, useState } from "react";
import { Trash2, Upload, Users, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCampaignStore } from "@/store/campaign";
import { parseContactsJson } from "@/lib/validations";
import { displayPhone } from "@/lib/utils";

/** Carga y validación de contactos desde un archivo JSON. */
export function ContactsUploader() {
  const contacts = useCampaignStore((s) => s.contacts);
  const mergeContacts = useCampaignStore((s) => s.mergeContacts);
  const clearContacts = useCampaignStore((s) => s.clearContacts);

  const inputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleFile(file: File) {
    setFeedback(null);
    setErrors([]);
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const { valid, errors: validationErrors, duplicates } =
        parseContactsJson(raw);

      if (validationErrors.length) {
        setErrors(
          validationErrors
            .slice(0, 5)
            .map((e) => `${e.path || "raíz"}: ${e.message}`)
        );
        return;
      }

      const { added, skipped } = mergeContacts(valid);
      setFeedback(
        `${added} contactos añadidos · ${skipped + duplicates} duplicados omitidos`
      );
    } catch {
      setErrors(["El archivo no es un JSON válido."]);
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>
          <Users className="text-whatsapp" />
          Contactos
          <Badge className="ml-auto">{contacts.length} válidos</Badge>
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
          {contacts.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                clearContacts();
                setFeedback(null);
              }}
              title="Vaciar contactos"
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

        <div className="mt-1 flex-1 overflow-auto rounded-md border border-border">
          {contacts.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              Formato esperado:{" "}
              <code className="text-whatsapp">
                [{`{ "name": "Juan", "phone": "573001234567" }`}]
              </code>
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {contacts.slice(0, 50).map((c, i) => (
                <li
                  key={`${c.phone}-${i}`}
                  className="flex items-center justify-between px-3 py-1.5"
                >
                  <span className="truncate">{c.name || "Sin nombre"}</span>
                  <span className="text-xs text-muted-foreground">
                    {displayPhone(c.phone)}
                  </span>
                </li>
              ))}
              {contacts.length > 50 && (
                <li className="px-3 py-1.5 text-center text-xs text-muted-foreground">
                  …y {contacts.length - 50} más
                </li>
              )}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
