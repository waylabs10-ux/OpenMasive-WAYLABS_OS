import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina clases de Tailwind resolviendo conflictos. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Normaliza un número de teléfono: deja solo dígitos. */
export function normalizePhone(raw: string): string {
  return (raw || "").replace(/[^\d]/g, "");
}

/** Formatea milisegundos a un texto legible (ej: "~18 min"). */
export function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "0 s";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} s`;
}

/** Formatea un teléfono colombiano/internacional para mostrar (+57 300...). */
export function displayPhone(phone: string): string {
  if (!phone) return "";
  return phone.startsWith("+") ? phone : `+${phone}`;
}

/** Formatea una hora ISO a HH:MM:SS local. */
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("es-CO", { hour12: false });
  } catch {
    return iso;
  }
}
