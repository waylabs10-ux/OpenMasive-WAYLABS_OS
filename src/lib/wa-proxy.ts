/**
 * Utilidades de servidor para hablar con el wa-server (puerto 3001).
 *
 * Centraliza el manejo de errores y el parseo seguro de JSON: si el wa-server
 * no responde, o responde con algo que NO es JSON (p. ej. una página HTML por
 * una colisión de puertos), devolvemos un resultado controlado en lugar de
 * lanzar una excepción que acabaría en un 500 poco claro.
 */

export const WA_SERVER_URL =
  process.env.WA_SERVER_URL ?? "http://localhost:3001";

export interface ProxyResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export async function proxyFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<ProxyResult<T>> {
  try {
    const res = await fetch(`${WA_SERVER_URL}${path}`, {
      ...init,
      cache: "no-store",
    });

    const text = await res.text();
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      // El wa-server respondió algo que no es JSON (probable colisión de
      // puertos: el frontend y el wa-server compartiendo el 3001).
      return {
        ok: false,
        status: 502,
        data: null,
        error:
          "El wa-server devolvió una respuesta no válida (¿colisión de puertos? " +
          "Asegúrate de que el frontend use el 3000 y el wa-server el 3001).",
      };
    }

    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      data: null,
      error: `No se pudo contactar el wa-server (${WA_SERVER_URL}): ${
        (err as Error).message
      }`,
    };
  }
}
