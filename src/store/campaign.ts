import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Contact, Message, CampaignConfig } from "@/lib/types";

/**
 * Store de Zustand con persistencia en localStorage.
 * Guarda contactos, mensajes y configuración para que la app sobreviva a
 * recargas del navegador (regla de negocio 6: persistencia total).
 */

interface CampaignState {
  contacts: Contact[];
  messages: Message[];
  config: CampaignConfig;

  setContacts: (contacts: Contact[]) => void;
  /** Fusiona contactos nuevos evitando duplicados por teléfono. */
  mergeContacts: (incoming: Contact[]) => { added: number; skipped: number };
  clearContacts: () => void;

  setMessages: (messages: Message[]) => void;
  mergeMessages: (incoming: Message[]) => { added: number; skipped: number };
  clearMessages: () => void;

  setConfig: (config: Partial<CampaignConfig>) => void;
  reset: () => void;
}

const DEFAULT_CONFIG: CampaignConfig = {
  minDelay: 8000,
  maxDelay: 25000,
  batchSize: 30,
  messageSelection: "single",
  selectedMessageId: undefined,
  dedupeBy: "phone",
};

export const useCampaignStore = create<CampaignState>()(
  persist(
    (set, get) => ({
      contacts: [],
      messages: [],
      config: DEFAULT_CONFIG,

      setContacts: (contacts) => set({ contacts }),

      mergeContacts: (incoming) => {
        const existing = get().contacts;
        const seen = new Set(existing.map((c) => c.phone));
        let added = 0;
        let skipped = 0;
        const merged = [...existing];
        for (const contact of incoming) {
          if (seen.has(contact.phone)) {
            skipped += 1;
            continue;
          }
          seen.add(contact.phone);
          merged.push(contact);
          added += 1;
        }
        set({ contacts: merged });
        return { added, skipped };
      },

      clearContacts: () => set({ contacts: [] }),

      setMessages: (messages) => set({ messages }),

      mergeMessages: (incoming) => {
        const existing = get().messages;
        const seen = new Set(existing.map((m) => m.id));
        let added = 0;
        let skipped = 0;
        const merged = [...existing];
        for (const msg of incoming) {
          if (seen.has(msg.id)) {
            skipped += 1;
            continue;
          }
          seen.add(msg.id);
          merged.push(msg);
          added += 1;
        }
        set({ messages: merged });
        return { added, skipped };
      },

      clearMessages: () => set({ messages: [] }),

      setConfig: (config) =>
        set((state) => ({ config: { ...state.config, ...config } })),

      reset: () => set({ contacts: [], messages: [], config: DEFAULT_CONFIG }),
    }),
    {
      name: "wa-bulk-campaign",
    }
  )
);
