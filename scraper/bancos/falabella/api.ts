/**
 * Obtención de los descuentos de Banco Falabella.
 *
 * No hay API pública, y en general tampoco bloqueo: www.bancofalabella.cl
 * responde a `fetch` plano desde una IP residencial (comprobado el 2026-09-18).
 * Pero está detrás de Cloudflare, que a IPs de datacenter (el servidor) les
 * responde 403. En ese caso se repite todo con un navegador real (Playwright,
 * igual que Santander): se abre el listado para pasar el desafío y desde la
 * página se piden las fichas. El sitio es Next.js (App Router)
 * sobre Contentful y los datos vienen en el payload RSC que el HTML trae
 * embebido en `self.__next_f.push([1, "…"])`, así que basta con leer ese stream:
 *
 *   /descuentos/todos            → `benefitCardsData`: todas las tarjetas (~239)
 *   /descuentos/detalle/<slug>   → `benefitData`: categorías, canal, descripción y legal
 *
 * Son ~230 fichas de ~1 MB cada una; con 4 en paralelo tarda menos de un minuto.
 */
import { ErrorFuente } from '../../tipos.ts';
import type { BeneficioCrudo, DetalleFicha, TarjetaListado } from './tipos.ts';

export const ORIGEN = 'https://www.bancofalabella.cl';
export const PAGINA = `${ORIGEN}/descuentos/todos`;

const PARALELO = 4;
const REINTENTOS = 3;
const TIMEOUT_MS = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Payload RSC
// ---------------------------------------------------------------------------

/**
 * Filas del stream RSC (`id → valor`). Cada fila es `<id hex>:<json>\n`, salvo
 * las binarias/de texto (`<id>:T<largo hex>,<bytes>`), que no terminan en salto
 * de línea y cuyo largo va en bytes UTF-8: por eso se recorre un Buffer.
 */
function filasRsc(html: string): Map<string, unknown> {
  let stream = '';
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    const [tipo, dato] = JSON.parse(m[1]) as [number, unknown];
    if (tipo === 1 && typeof dato === 'string') stream += dato;
  }

  const buf = Buffer.from(stream, 'utf8');
  const filas = new Map<string, unknown>();
  let i = 0;
  while (i < buf.length) {
    const dosPuntos = buf.indexOf(0x3a, i);
    if (dosPuntos < 0) break;
    const id = buf.toString('latin1', i, dosPuntos);
    const cabecera = buf.toString('latin1', dosPuntos + 1, dosPuntos + 20).match(/^([A-Za-z])([0-9a-f]+),/);

    if (/^[0-9a-f]+$/.test(id) && cabecera) {
      // Fila con largo: T = texto; las demás (typed arrays, streams anidados) se saltan.
      const inicio = dosPuntos + 1 + cabecera[0].length;
      const fin = inicio + parseInt(cabecera[2], 16);
      if (cabecera[1] === 'T') filas.set(id, buf.toString('utf8', inicio, fin));
      i = fin;
      continue;
    }

    const nl = buf.indexOf(0x0a, dosPuntos);
    const fin = nl < 0 ? buf.length : nl;
    if (/^[0-9a-f]+$/.test(id)) {
      const cuerpo = buf.toString('utf8', dosPuntos + 1, fin);
      if (/^[[{"]/.test(cuerpo)) {
        try {
          filas.set(id, JSON.parse(cuerpo));
        } catch {
          // fila que no es JSON (no nos interesa)
        }
      }
    }
    i = fin + 1;
  }
  return filas;
}

/**
 * Resuelve las referencias del RSC dentro de un valor:
 *   "$5e"                              → la fila 5e (el legal viene así, como fila T)
 *   "$28:props:benefitCardsData:0:region" → un camino dentro de la fila 28
 *   "$$8.000"                          → "$8.000" (escape)
 *   "$undefined"                       → undefined
 */
function resolver(filas: Map<string, unknown>, valor: unknown, profundidad = 0): unknown {
  if (profundidad > 50) return valor;
  if (typeof valor === 'string') {
    if (valor.startsWith('$$')) return valor.slice(1);
    if (valor === '$undefined') return undefined;
    const m = valor.match(/^\$([0-9a-f]+)((?::[^:]+)*)$/);
    if (!m || !filas.has(m[1])) return valor;
    let nodo: unknown = filas.get(m[1]);
    for (const clave of m[2].split(':').slice(1)) {
      // Un elemento React se serializa como ["$", tipo, key, props].
      if (clave === 'props' && Array.isArray(nodo) && nodo[0] === '$') nodo = nodo[3];
      else nodo = (nodo as Record<string, unknown> | undefined)?.[clave];
    }
    return resolver(filas, nodo, profundidad + 1);
  }
  if (Array.isArray(valor)) return valor.map((v) => resolver(filas, v, profundidad + 1));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, resolver(filas, v, profundidad + 1)]));
  }
  return valor;
}

/** Primer objeto (en cualquier fila) que tenga la propiedad `clave`, ya resuelto. */
function buscarPropiedad<T>(filas: Map<string, unknown>, clave: string): T | null {
  const buscar = (nodo: unknown): Record<string, unknown> | null => {
    if (!nodo || typeof nodo !== 'object') return null;
    if (!Array.isArray(nodo) && Object.hasOwn(nodo, clave)) return nodo as Record<string, unknown>;
    for (const v of Object.values(nodo)) {
      const r = buscar(v);
      if (r) return r;
    }
    return null;
  };
  for (const fila of filas.values()) {
    const obj = buscar(fila);
    if (obj) return resolver(filas, obj[clave]) as T;
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** Una petición: devuelve el status y, si es 2xx, el HTML. */
type Pedir = (url: string) => Promise<{ status: number; html: string }>;

const pedirConFetch: Pedir = async (url) => {
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-CL,es;q=0.9' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: r.status, html: r.ok ? await r.text() : '' };
};

class ErrorHttp extends Error {
  status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function traerHtml(pedir: Pedir, url: string): Promise<string> {
  let ultimo: unknown;
  for (let intento = 1; intento <= REINTENTOS; intento++) {
    try {
      const { status, html } = await pedir(url);
      if (status >= 200 && status < 300) return html;
      throw new ErrorHttp(status);
    } catch (err) {
      ultimo = err;
      // 4xx no mejora reintentando; 5xx (el CDN responde 502 de vez en cuando) sí.
      if (err instanceof ErrorHttp && err.status >= 400 && err.status < 500) break;
      if (intento < REINTENTOS) await new Promise((res) => setTimeout(res, 1000 * intento));
    }
  }
  throw ultimo;
}

async function traerDetalle(pedir: Pedir, linkUrl: string): Promise<DetalleFicha> {
  const html = await traerHtml(pedir, new URL(linkUrl, ORIGEN).href);
  const detalle = buscarPropiedad<DetalleFicha>(filasRsc(html), 'benefitData');
  if (!detalle) throw new Error('la ficha no trae "benefitData"');
  return detalle;
}

// ---------------------------------------------------------------------------
// Respaldo con navegador (Cloudflare bloquea IPs de datacenter)
// ---------------------------------------------------------------------------

/** Fuerza el navegador aunque `fetch` funcione (para probar el respaldo). */
const FORZAR_NAVEGADOR = process.env.FALABELLA_NAVEGADOR === '1';

/**
 * Abre el listado en Chromium con ventana (en un servidor, bajo xvfb-run) para
 * que Cloudflare emita sus cookies, y corre `trabajo` con un `Pedir` que hace
 * los `fetch` desde la página, heredando esas cookies.
 */
async function conNavegador<T>(trabajo: (pedir: Pedir) => Promise<T>): Promise<T> {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new ErrorFuente(
      'falabella',
      'Cloudflare bloqueó el fetch (403) y el respaldo requiere Playwright.\n' +
        '  Instálalo con:  pnpm install && pnpm exec playwright install --with-deps chromium',
    );
  }
  const navegador = await chromium.launch({
    channel: 'chromium',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const contexto = await navegador.newContext({
      locale: 'es-CL',
      timezoneId: 'America/Santiago',
      viewport: { width: 1366, height: 900 },
    });
    const pagina = await contexto.newPage();
    await pagina.goto(PAGINA, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    // Si hay desafío de Cloudflare, la página se recarga sola al resolverlo.
    await pagina
      .waitForFunction(() => document.documentElement.innerHTML.includes('benefitCardsData'), null, { timeout: 60_000 })
      .catch(() => {});

    const pedir: Pedir = (url) =>
      pagina.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include', headers: { Accept: 'text/html' } });
        return { status: r.status, html: r.ok ? await r.text() : '' };
      }, url);
    return await trabajo(pedir);
  } finally {
    await navegador.close();
  }
}

export async function traerBeneficios(): Promise<BeneficioCrudo[]> {
  if (FORZAR_NAVEGADOR) return conNavegador(traerCon);
  try {
    return await traerCon(pedirConFetch);
  } catch (err) {
    if (!(err instanceof ErrorFuente && err.message.includes('HTTP 403'))) throw err;
    console.warn('  ⚠ Cloudflare respondió 403 al fetch; reintentando con navegador…');
    return conNavegador(traerCon);
  }
}

async function traerCon(pedir: Pedir): Promise<BeneficioCrudo[]> {
  let html: string;
  try {
    html = await traerHtml(pedir, PAGINA);
  } catch (err) {
    throw new ErrorFuente('falabella', `No se pudo descargar ${PAGINA}: ${err}`);
  }

  const tarjetas = buscarPropiedad<TarjetaListado[]>(filasRsc(html), 'benefitCardsData');
  if (!Array.isArray(tarjetas) || !tarjetas.length) {
    throw new ErrorFuente(
      'falabella',
      `${PAGINA} no trae "benefitCardsData" en el payload RSC. ¿Cambió el sitio? ` +
        'Revisa en las DevTools qué componente recibe las tarjetas.',
    );
  }

  // Hay tarjetas repetidas (misma ficha destacada dos veces): se toma la primera.
  const primeras = new Map<string, TarjetaListado>();
  for (const t of tarjetas) {
    const link = t?.benefitCard?.linkUrl;
    if (link && !primeras.has(link)) primeras.set(link, t);
  }

  const pendientes = [...primeras.values()];
  const resultado: BeneficioCrudo[] = pendientes.map((tarjeta) => ({ tarjeta, detalle: null }));
  const fallidas: string[] = [];
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < pendientes.length) {
      const i = siguiente++;
      const link = pendientes[i].benefitCard.linkUrl;
      try {
        resultado[i].detalle = await traerDetalle(pedir, link);
      } catch (err) {
        fallidas.push(`${link} (${err})`);
      }
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, trabajador));

  if (fallidas.length) {
    // Sin ficha el beneficio se arma igual con los datos de la tarjeta.
    console.warn(`  ⚠ ${fallidas.length} fichas no se pudieron leer; se usan solo los datos del listado:`);
    for (const f of fallidas.slice(0, 5)) console.warn(`    ${f}`);
    if (fallidas.length > 5) console.warn(`    … y ${fallidas.length - 5} más`);
  }
  if (fallidas.length > pendientes.length / 2) {
    throw new ErrorFuente('falabella', `Fallaron ${fallidas.length} de ${pendientes.length} fichas. ¿Cambió el sitio o hay bloqueo?`);
  }
  return resultado;
}
