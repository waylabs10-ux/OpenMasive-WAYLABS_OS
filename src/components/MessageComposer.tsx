"use client";

import { useMemo } from "react";
import { MessageSquare, Eye, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCampaignStore } from "@/store/campaign";
import { renderTemplate } from "@/lib/deduplication";
import type { Contact } from "@/lib/types";

/** Id estable del mensaje redactado a mano (la dedup real es por teléfono). */
export const COMPOSED_MESSAGE_ID = "mensaje";

const SAMPLE_CONTACT: Contact = {
  name: "María López",
  phone: "573009876543",
};

const MAX_LEN = 4096;

/** Campo de texto para redactar el mensaje a enviar, con preview en vivo. */
export function MessageComposer() {
  const messages = useCampaignStore((s) => s.messages);
  const contacts = useCampaignStore((s) => s.contacts);
  const setMessages = useCampaignStore((s) => s.setMessages);

  const text = messages[0]?.text ?? "";

  const sample = useMemo<Contact>(
    () => contacts[0] ?? SAMPLE_CONTACT,
    [contacts]
  );

  function handleChange(value: string) {
    const trimmed = value.slice(0, MAX_LEN);
    if (trimmed.trim().length === 0) {
      setMessages([]);
    } else {
      setMessages([{ id: COMPOSED_MESSAGE_ID, text: trimmed }]);
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>
          <MessageSquare className="text-whatsapp" />
          Mensaje
          <Badge className="ml-auto">
            {text.length}/{MAX_LEN}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <Textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Escribe aquí el mensaje que se enviará a todos los contactos…"
          className="min-h-[140px] flex-1 resize-none"
        />

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Variables:{" "}
            <code className="text-whatsapp">{"{name}"}</code>,{" "}
            <code className="text-whatsapp">{"{phone}"}</code> y cualquier
            columna del CSV.
          </p>
          {text.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleChange("")}
              title="Borrar mensaje"
            >
              <Trash2 className="text-destructive" />
            </Button>
          )}
        </div>

        {text.trim().length > 0 && (
          <div className="rounded-md border border-border bg-secondary/40 p-2.5">
            <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Eye className="h-3.5 w-3.5" />
              Vista previa ({sample.name || displayName(sample)})
            </div>
            <p className="whitespace-pre-wrap text-sm text-whatsapp">
              {renderTemplate(text, sample)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function displayName(contact: Contact): string {
  return typeof contact.phone === "string" ? `+${contact.phone}` : "ejemplo";
}
