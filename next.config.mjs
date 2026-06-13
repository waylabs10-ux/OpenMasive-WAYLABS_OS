const WA_SERVER_URL = process.env.WA_SERVER_URL ?? "http://localhost:3001";

/**
 * Configuración de Next.js.
 * Se añaden rewrites para exponer el servidor de WhatsApp (OpenWA) que corre
 * en el puerto 3001 bajo la ruta `/wa-server/*`, evitando problemas de CORS.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/wa-server/:path*",
        destination: `${WA_SERVER_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
