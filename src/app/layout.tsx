import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenMasive — WhatsApp Bulk Sender",
  description:
    "Envío masivo de WhatsApp con deduplicación inteligente y protección anti-bloqueo.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
