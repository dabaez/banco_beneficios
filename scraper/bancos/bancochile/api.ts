/**
 * Obtención de los beneficios de Banco de Chile.
 *
 * El listado del sitio (Modyo) se arma en el navegador con la API de contenido
 * del CMS, que responde a `fetch` plano pese a Incapsula (comprobado el
 * 2026-09-18): 9 páginas de 100 entradas, ~450 KB cada una.
 */
import { ErrorFuente } from '../../tipos.ts';
import type { Entrada, RespuestaEntradas } from './tipos.ts';

export const ORIGEN = 'https://sitiospublicos.bancochile.cl';
export const PAGINA = `${ORIGEN}/personas/beneficios/todos-los-beneficios`;
const API = `${ORIGEN}/api/content/spaces/personas/types/beneficios/entries`;

const POR_PAGINA = 100;
const REINTENTOS = 3;
const TIMEOUT_MS = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function traerPagina(pagina: number): Promise<RespuestaEntradas> {
  const url = `${API}?per_page=${POR_PAGINA}&page=${pagina}`;
  let ultimo: unknown;
  for (let intento = 1; intento <= REINTENTOS; intento++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'es-CL,es;q=0.9' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.status >= 400 && r.status < 500) throw Object.assign(new Error(`HTTP ${r.status}`), { definitivo: true });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Si Incapsula bloquea responde 200 con una página HTML de desafío.
      if (!/json/.test(r.headers.get('content-type') ?? '')) {
        throw Object.assign(new Error(`respondió ${r.headers.get('content-type')} en vez de JSON (¿bloqueo de Incapsula?)`), {
          definitivo: true,
        });
      }
      return (await r.json()) as RespuestaEntradas;
    } catch (err) {
      ultimo = err;
      if ((err as { definitivo?: boolean }).definitivo) break;
      if (intento < REINTENTOS) await new Promise((res) => setTimeout(res, 1000 * intento));
    }
  }
  throw new ErrorFuente('bancochile', `No se pudo leer ${url}: ${ultimo}`);
}

export async function traerBeneficios(): Promise<Entrada[]> {
  const primera = await traerPagina(1);
  if (!Array.isArray(primera?.entries) || !primera.meta?.total_pages) {
    throw new ErrorFuente('bancochile', `${API} no devolvió "entries"/"meta.total_pages". ¿Cambió la API de Modyo?`);
  }

  const entradas = [...primera.entries];
  for (let p = 2; p <= primera.meta.total_pages; p++) entradas.push(...(await traerPagina(p)).entries);

  // Deduplicar por uuid por si el orden cambia entre páginas mientras se descarga.
  const unicas = [...new Map(entradas.map((e) => [e.meta.uuid, e])).values()];
  if (unicas.length < primera.meta.total_entries * 0.9) {
    throw new ErrorFuente('bancochile', `Se leyeron ${unicas.length} de ${primera.meta.total_entries} beneficios.`);
  }
  return unicas;
}
