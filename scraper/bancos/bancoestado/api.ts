/**
 * Obtención de los beneficios de BancoEstado.
 *
 * No hay API: los beneficios vienen renderizados en el HTML de páginas AEM
 * (ver tipos.ts). Y como con Santander, www.bancoestado.cl está detrás de
 * Akamai Bot Manager. Comprobado el 2026-09-18:
 *   curl / fetch de Node   → página "no encontrada" con referencia de Akamai
 *   Chromium headless      → 200, pero un HTML de 650 bytes sin beneficios
 *   Chromium con ventana   → 200 con el contenido real
 * Así que se abre un navegador con ventana (xvfb-run en un servidor), se carga
 * el listado para que Akamai emita sus cookies y desde la propia página se
 * piden los demás HTML con `fetch` y se leen con `DOMParser`. Al Node solo
 * vuelven datos ya extraídos.
 *
 * Playwright es una dependencia opcional: si no está instalada, el scraper
 * informa cómo instalarla y sigue con los demás bancos.
 */
import { ErrorFuente } from '../../tipos.ts';
import type { DetalleCrudo, ModalCrudo, PaginaListado, TarjetaCruda } from './tipos.ts';

const BASE = 'https://www.bancoestado.cl/content/bancoestado-public/cl/es/home/home/todosuma---bancoestado-personas/';

export const PAGINA = `${BASE}todos-beneficios.html`;

/** Páginas de listado. Las pestañas Bieeneficios, Música y Sabores enlazan a su propia página. */
export const LISTADOS: Record<PaginaListado, string> = {
  todos: PAGINA,
  bieneficios: `${BASE}bieneeeneficios-que-te-vienen-bien---bancoestado-personas.html`,
  sabores: `${BASE}un-mes-de-sabores---bancoestado-personas.html`,
  panoramas: `${BASE}con-bancoestado-la-entretencion-es-para-todo-el-ano---bancoestado-pers.html`,
};

const TIMEOUT_MS = 90_000;
/** Fichas de detalle pedidas en paralelo desde la página (son ~75). */
const PARALELO = 4;

/** Escape para depurar; en headless Akamai sirve una página vacía. */
const HEADLESS = process.env.BANCOESTADO_HEADLESS === '1';

async function cargarPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new ErrorFuente(
      'bancoestado',
      'BancoEstado requiere Playwright (el sitio bloquea a cualquier cliente que no sea un navegador).\n' +
        '  Instálalo con:  pnpm install && pnpm exec playwright install --with-deps chromium\n' +
        '  O sáltalo con:  node scraper --banco bci',
    );
  }
}

type ResultadoPagina = { tarjetas: Omit<TarjetaCruda, 'detalle'>[]; detalles: Record<string, DetalleCrudo | null>; errores: string[] };

/**
 * Corre dentro del navegador: se serializa con `toString()`, así que todo lo
 * que usa tiene que estar definido aquí adentro.
 */
async function extraerEnPagina({ listados, paralelo }: { listados: [string, string][]; paralelo: number }): Promise<ResultadoPagina> {
  const errores: string[] = [];
  // El CMS deja espacios de ancho cero (U+200B) pegados a muchos textos.
  const texto = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/[\s\u200b]+/g, ' ').trim();
  const absoluta = (u: string | null | undefined) => (u ? new URL(u, location.origin).href : null);

  async function documento(url: string): Promise<Document> {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Lo que Akamai sirve a un navegador sospechoso es un HTML casi vacío.
    if (html.length < 5000) throw new Error(`respuesta de ${html.length} bytes (¿bloqueo de Akamai?)`);
    return doc;
  }

  function modal(doc: Document, id: string | null): ModalCrudo | null {
    if (!id) return null;
    // El modal va fuera de la tarjeta; el id puede tener tildes, así que no se usa querySelector('#…').
    const m = [...doc.querySelectorAll('.modal')].find((x) => x.id === id);
    const cuerpo = m?.querySelector('.modal-body');
    if (!cuerpo) return null;
    return {
      textos: [...cuerpo.querySelectorAll('p')].filter((p) => !p.closest('.modal-banner')).map(texto).filter(Boolean),
      locales: [...cuerpo.querySelectorAll('li')].map(texto).filter(Boolean),
      link: absoluta(cuerpo.querySelector('a[href]')?.getAttribute('href')),
    };
  }

  const tarjetas: ResultadoPagina['tarjetas'] = [];
  for (const [pagina, url] of listados) {
    let doc: Document;
    try {
      doc = await documento(url);
    } catch (err) {
      errores.push(`listado ${pagina}: ${err}`);
      continue;
    }
    for (const c of doc.querySelectorAll('.card-beneficios[data-card-id]')) {
      const clase = [...c.classList].find((x) => x.startsWith('msd-beneficios-content-list-card--')) ?? '';
      const variante = clase.replace('msd-beneficios-content-list-card--', '');
      const parte = (sufijo: string) => c.querySelector(`.${clase}--${sufijo}`);
      let subfiltros: Record<string, string[]> = {};
      try {
        subfiltros = JSON.parse(c.getAttribute('data-subfiltros') || '{}');
      } catch {
        errores.push(`subfiltros ilegibles en ${pagina}/${c.getAttribute('data-card-id')}`);
      }
      const localidad = parte('localidad');
      tarjetas.push({
        pagina: pagina as PaginaListado,
        variante,
        id: c.getAttribute('data-card-id') ?? '',
        nombre: (c.getAttribute('data-name') ?? '').trim(),
        categorias: (c.getAttribute('data-category') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && s !== 'todos'),
        subfiltros,
        pretitulo: texto(parte('pretitle')),
        titulo: texto(parte('title')),
        subtitulo: texto(parte('subtitle')),
        descripcion: texto(parte('descripcion')),
        imagen: absoluta(parte('image')?.querySelector('img')?.getAttribute('src')),
        link: absoluta(c.querySelector('a.button-card')?.getAttribute('href')),
        modal: modal(doc, c.querySelector('[data-modal-id]')?.getAttribute('data-modal-id') ?? null),
        evento: localidad ? { lugar: texto(localidad), fecha: texto(parte('fecha')) } : null,
      });
    }
  }

  function leerDetalle(doc: Document, url: string): DetalleCrudo {
    doc.querySelectorAll('script, style, noscript, .cmp-experiencefragment--footer, footer').forEach((e) => e.remove());

    const secciones: Record<string, string> = {};
    for (const t of doc.querySelectorAll('.msd-tarifa')) {
      const k = texto(t.querySelector('.msd-title-tarifa'));
      const v = texto(t.querySelector('.msd-text-tarifa'));
      if (k && v) secciones[k] = v;
    }

    // El contenido empieza en la miga de pan; lo anterior es menú y banners del banco.
    const textos: string[] = [];
    let empezo = false;
    for (const e of doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li')) {
      if (e.closest('.msd-breadcrumb')) {
        empezo = true;
        continue;
      }
      if (!empezo || e.querySelector('p, li')) continue;
      const t = texto(e);
      if (t && t !== textos[textos.length - 1]) textos.push(t);
    }

    const legal =
      textos
        .filter((t) => t.length > 150 && /garant[ií]a estatal|cmfchile|no se responsabiliza|exclusiva responsabilidad/i.test(t))
        .sort((a, b) => b.length - a.length)[0] ?? '';

    // Fecha de modificación más reciente de los componentes (JSON en data-cmp-data-layer).
    let modificado: string | null = null;
    for (const e of doc.querySelectorAll('[data-cmp-data-layer]')) {
      const m = e.getAttribute('data-cmp-data-layer')?.match(/"repo:modifyDate":"([^"]+)"/);
      if (m && (!modificado || m[1] > modificado)) modificado = m[1];
    }
    const titulo = texto(doc.querySelector('.msd-breadcrumb .breadcrumb-item.active'));
    return { url, titulo, secciones, textos, legal, modificado };
  }

  // Fichas de detalle: solo las del propio sitio, sin repetir.
  const urls = [
    ...new Set(
      tarjetas.map((t) => t.link).filter((u): u is string => !!u && new URL(u).origin === location.origin && u.includes('/content/')),
    ),
  ];
  const detalles: Record<string, DetalleCrudo | null> = {};
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: paralelo }, async () => {
      while (siguiente < urls.length) {
        const url = urls[siguiente++];
        try {
          detalles[url] = leerDetalle(await documento(url), url);
        } catch (err) {
          errores.push(`ficha ${url}: ${err}`);
          detalles[url] = null;
        }
      }
    }),
  );

  return { tarjetas, detalles, errores };
}

export async function traerTarjetas(): Promise<TarjetaCruda[]> {
  const { chromium } = await cargarPlaywright();
  const navegador = await chromium.launch({
    // channel 'chromium' = binario completo, no el headless shell.
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
        'bancoestado',
        `La página de beneficios respondió ${res.status()}: Akamai bloqueó al navegador o cambió la ruta.\n` +
          '  En un servidor sin pantalla, ejecuta el scraper con: xvfb-run -a node scraper',
      );
    }

    const { tarjetas, detalles, errores } = await pagina.evaluate(extraerEnPagina, {
      listados: Object.entries(LISTADOS),
      paralelo: PARALELO,
    });

    for (const e of errores) console.warn(`  ⚠ BancoEstado: ${e}`);
    if (!tarjetas.length) {
      throw new ErrorFuente(
        'bancoestado',
        'No se encontró ninguna tarjeta de beneficio en los listados.\n' +
          (HEADLESS
            ? '  Estás en modo headless (BANCOESTADO_HEADLESS=1) y Akamai lo detecta. Quita esa variable.'
            : '  ¿Akamai bloqueó al navegador o cambió el HTML (clase .card-beneficios)?'),
      );
    }
    const porListado = Object.keys(LISTADOS).map((p) => `${p} ${tarjetas.filter((t) => t.pagina === p).length}`);
    const fichas = Object.values(detalles);
    console.log(`  Tarjetas: ${porListado.join(', ')}; fichas: ${fichas.filter(Boolean).length}/${fichas.length}`);

    return tarjetas.map((t) => ({ ...t, detalle: (t.link && detalles[t.link]) || null }));
  } finally {
    await navegador.close();
  }
}
