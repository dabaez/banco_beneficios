/**
 * Obtención de las promociones de Santander.
 *
 * banco.santander.cl está detrás de Akamai Bot Manager: el dominio entero
 * responde 403 a cualquier cliente que no ejecute el sensor JS (comprobado con
 * `fetch` de Node, curl con headers de Chrome, e incluso /robots.txt). Por eso
 * este adaptador —y solo este— necesita un navegador real: se abre la página de
 * beneficios para que Akamai emita sus cookies y desde ahí, en el contexto de la
 * página, se pide el JSON que la propia web consume.
 *
 * Importante: Akamai distingue headless. Comprobado el 2026-09-17 contra la
 * misma IP y el mismo binario de Chromium:
 *   headless shell (default)   → 403
 *   headless nuevo (--headless=new) → 403
 *   headed                     → 200
 * Por eso el navegador se lanza con ventana. En un servidor sin pantalla hay que
 * envolver la corrida en xvfb-run (ver scripts/deploy.sh).
 *
 * Playwright es una dependencia opcional: si no está instalada, el scraper
 * informa cómo instalarla y sigue con los demás bancos.
 */
import { ErrorFuente } from '../../tipos.ts';
import type { PromocionApi, RespuestaPromociones } from './tipos.ts';

export const PAGINA = 'https://banco.santander.cl/beneficios/';

/**
 * Mismos parámetros que usa el sitio. `per_page=9999` trae todo en una página
 * (son ~308) y `custom_fields=true` incluye vigencia, región y comuna.
 */
export const API_URL =
  'https://banco.santander.cl/beneficios/promociones.json' +
  '?per_page=9999&tags=home-disfrutadores&custom_fields=true&order_by=updated_at&desc=true';

const TIMEOUT_MS = 90_000;

/** Escape para depurar; en headless Akamai responde 403. */
const HEADLESS = process.env.SANTANDER_HEADLESS === '1';

/** Playwright solo se importa si de verdad se va a scrapear Santander. */
async function cargarPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new ErrorFuente(
      'santander',
      'Santander requiere Playwright (el sitio bloquea a cualquier cliente que no sea un navegador).\n' +
        '  Instálalo con:  pnpm install && pnpm exec playwright install --with-deps chromium\n' +
        '  O sáltalo con:  node scraper --banco bci',
    );
  }
}

export async function traerPromociones(): Promise<PromocionApi[]> {
  const { chromium } = await cargarPlaywright();
  const navegador = await chromium.launch({
    // channel 'chromium' = binario completo, no el headless shell (que Akamai bloquea).
    channel: 'chromium',
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const contexto = await navegador.newContext({
      locale: 'es-CL',
      timezoneId: 'America/Santiago',
      viewport: { width: 1366, height: 900 },
    });
    const pagina = await contexto.newPage();

    // Visitar la página primero: Akamai emite sus cookies al ejecutar el sensor.
    const res = await pagina.goto(PAGINA, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    if (res && res.status() >= 400) {
      throw new ErrorFuente(
        'santander',
        `La página de beneficios respondió ${res.status()}: Akamai bloqueó al navegador.\n` +
          (HEADLESS
            ? '  Estás en modo headless (SANTANDER_HEADLESS=1) y Akamai lo detecta. Quita esa variable.'
            : '  En un servidor sin pantalla, ejecuta el scraper con: xvfb-run -a node scraper'),
      );
    }

    // El fetch se hace desde la página para que herede origen y cookies.
    const json = await pagina.evaluate<RespuestaPromociones | { __error: string }, string>(async (url) => {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
      if (!r.ok) return { __error: `HTTP ${r.status}` };
      return (await r.json()) as RespuestaPromociones;
    }, API_URL);

    if ('__error' in json) {
      throw new ErrorFuente('santander', `promociones.json respondió ${json.__error} (¿Akamai o cambió la ruta?).`);
    }
    if (!Array.isArray(json.promociones)) {
      throw new ErrorFuente('santander', 'promociones.json no trae "promociones". ¿Cambió el formato?');
    }

    const esperadas = json.meta?.total_entries;
    if (esperadas != null && json.promociones.length !== esperadas) {
      console.warn(`  ⚠ Santander reporta ${esperadas} promociones pero llegaron ${json.promociones.length}.`);
    }

    // El CMS puede repetir una promoción si se actualiza durante la corrida.
    return [...new Map(json.promociones.map((p) => [p.id, p])).values()];
  } finally {
    await navegador.close();
  }
}
