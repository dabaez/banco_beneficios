/**
 * Copias livianas de las imágenes de los beneficios.
 *
 * Los bancos sirven imágenes de 100 KB a 30 MB (PNG de 800×800 en
 * Santander, 2,8 MB en BancoEstado) que el sitio muestra a ~350 px. Aquí
 * se descargan una vez, se reducen a WebP y se guardan en data/img/, que
 * deploy/scrape publica junto a beneficios.json. El beneficio conserva la URL
 * original en `imagen`/`logo`, y el sitio vuelve a ella si la copia no carga.
 *
 * El nombre de cada archivo es un hash de la URL original: si el archivo ya
 * existe no se vuelve a descargar. Los que ya ningún beneficio usa se borran.
 *
 * Descarga: BCI, Santander y Falabella responden a `fetch`. Banco de Chile
 * (Incapsula) y BancoEstado (Akamai) no: para ellos se usa un Chromium con
 * ventana (Playwright) que abre el sitio del host y pide la imagen desde la
 * página, con sus cookies. Si Playwright no está, esas imágenes quedan solo
 * con la URL original.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import sharp from 'sharp';
import type { Beneficio } from '../shared/beneficio.ts';

/** Ruta pública de las copias, relativa a la raíz del sitio. */
const RUTA_PUBLICA = 'img';

/**
 * `imagen`: tarjeta (~350 px de ancho, 3:2) y detalle (hasta 704 px, 21:9);
 * 720 px sirve para ambos, también en pantallas 2x para la tarjeta.
 * `logo`: se muestra a 24 px.
 */
const VARIANTES = {
  imagen: { sufijo: 'i', ancho: 720, alto: 720, calidad: 72 },
  logo: { sufijo: 'l', ancho: 64, alto: 64, calidad: 80 },
} as const;
type Variante = keyof typeof VARIANTES;

const TIMEOUT_MS = 20_000;
// Santander tiene fotos de 30 MB y 14000×3700 px: los límites son para lo absurdo.
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_PIXELES = 100_000_000;
const EN_PARALELO = 6;
// Uno identificable, no uno de Chrome: Akamai (Santander) bloquea a quien dice
// ser Chrome y no lo es, pero deja pasar las imágenes a un cliente honesto.
const USER_AGENT = 'banco-beneficios-visor/1.0 (visor personal no oficial de beneficios; github.com/dabaez/banco_beneficios)';

function nombreArchivo(url: string, variante: Variante): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 20);
  return `${hash}-${VARIANTES[variante].sufijo}.webp`;
}

async function descargarConFetch(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tipo = res.headers.get('content-type') ?? '';
  // Los bloqueos anti-bot responden 200 con una página HTML.
  if (!tipo.startsWith('image/')) throw new Error(`respondió ${tipo || 'sin content-type'}, no una imagen`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Un Chromium compartido, que se abre recién cuando `fetch` falla, con una
 * página por host: visitar el sitio primero hace que el anti-bot emita sus
 * cookies, y la imagen se pide desde esa página (mismo origen). Si Chromium o
 * una página se cierran a mitad de camino, se vuelven a abrir.
 */
class Navegador {
  private navegador: Promise<Browser> | null = null;
  private paginas = new Map<string, Promise<Page>>();

  private abrir(): Promise<Browser> {
    if (!this.navegador) {
      const navegador = import('playwright').then(async ({ chromium }) => {
        const n = await chromium.launch({
          // Con ventana: Akamai bloquea headless (ver scraper/bancos/santander/api.ts).
          channel: 'chromium',
          headless: false,
          args: ['--disable-blink-features=AutomationControlled'],
        });
        n.on('disconnected', () => {
          if (this.navegador !== navegador) return;
          this.navegador = null;
          this.paginas.clear();
        });
        return n;
      });
      this.navegador = navegador;
    }
    return this.navegador;
  }

  private pagina(origen: string): Promise<Page> {
    let pagina = this.paginas.get(origen);
    if (!pagina) {
      pagina = (async () => {
        const navegador = await this.abrir();
        const contexto = await navegador.newContext({ locale: 'es-CL' });
        const p = await contexto.newPage();
        p.on('close', () => {
          if (this.paginas.get(origen) === pagina) this.paginas.delete(origen);
        });
        // La raíz puede redirigir o dar 403: lo que importa son las cookies.
        await p.goto(`${origen}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
        return p;
      })();
      this.paginas.set(origen, pagina);
    }
    return pagina;
  }

  async descargar(url: string, reintentar = true): Promise<Buffer> {
    const pagina = await this.pagina(new URL(url).origin);
    try {
      return await this.descargarDesde(pagina, url);
    } catch (err) {
      if (!reintentar || !pagina.isClosed()) throw err;
      return this.descargar(url, false);
    }
  }

  private async descargarDesde(pagina: Page, url: string): Promise<Buffer> {
    const desdePagina = await pagina.evaluate(async ([u, timeout]) => {
      try {
        const r = await fetch(u, { credentials: 'include', signal: AbortSignal.timeout(timeout) });
        const tipo = r.headers.get('content-type') ?? '';
        if (!r.ok || !tipo.startsWith('image/')) return { error: `HTTP ${r.status} ${tipo}` };
        const bytes = new Uint8Array(await r.arrayBuffer());
        let binario = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return { base64: btoa(binario) };
      } catch (err) {
        return { error: String(err) };
      }
    }, [url, TIMEOUT_MS] as const);
    if (desdePagina.base64 !== undefined) return Buffer.from(desdePagina.base64, 'base64');

    // Algunos hosts (el CDN de Banco de Chile) no se dejan pedir desde la
    // página, pero sí con las cookies del contexto fuera de ella.
    const res = await pagina.context().request.get(url, { timeout: TIMEOUT_MS });
    const tipo = res.headers()['content-type'] ?? '';
    if (!res.ok() || !tipo.startsWith('image/')) {
      throw new Error(`navegador: ${desdePagina.error}; request: HTTP ${res.status()} ${tipo}`);
    }
    return res.body();
  }

  async cerrar() {
    if (this.navegador) await (await this.navegador).close().catch(() => {});
  }
}

async function comprimir(original: Buffer, variante: Variante): Promise<Buffer> {
  const { ancho, alto, calidad } = VARIANTES[variante];
  return sharp(original, { limitInputPixels: MAX_PIXELES })
    .rotate() // respeta la orientación EXIF
    .resize({ width: ancho, height: alto, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: calidad, effort: 5 })
    .toBuffer();
}

/** Ejecuta `fn` sobre `items` con a lo más `n` en paralelo. */
async function enParalelo<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (siguiente < items.length) await fn(items[siguiente++]);
    }),
  );
}

/**
 * Llena `imagenOptimizada`/`logoOptimizado` de cada beneficio con una copia en
 * `directorio`, descargando solo lo que falta (nada si `soloCache`). Borra del
 * directorio las copias que ya no usa ningún beneficio. Una imagen que falla
 * se queda con su URL original.
 */
export async function optimizarImagenes(beneficios: Beneficio[], directorio: string, soloCache = false) {
  fs.mkdirSync(directorio, { recursive: true });
  const existentes = new Set(fs.readdirSync(directorio).filter((f) => f.endsWith('.webp')));

  // URL + variante → nombre de archivo; varias ofertas comparten imagen.
  const pedidos = new Map<string, { url: string; variante: Variante; archivo: string }>();
  for (const b of beneficios) {
    for (const [variante, url] of [['imagen', b.imagen], ['logo', b.logo]] as const) {
      if (!url) continue;
      const archivo = nombreArchivo(url, variante);
      pedidos.set(archivo, { url, variante, archivo });
    }
  }

  const faltan = soloCache ? [] : [...pedidos.values()].filter((p) => !existentes.has(p.archivo));
  console.log(`  ${pedidos.size} imágenes, ${pedidos.size - faltan.length} ya en caché, ${faltan.length} por descargar`);

  const navegador = new Navegador();
  let bytesOriginales = 0;
  let bytesCopias = 0;
  const errores: string[] = [];
  let conNavegador = 0;
  try {
    await enParalelo(faltan, EN_PARALELO, async ({ url, variante, archivo }) => {
      try {
        let original: Buffer;
        try {
          original = await descargarConFetch(url);
        } catch {
          original = await navegador.descargar(url);
          conNavegador++;
        }
        if (original.length > MAX_BYTES) throw new Error(`pesa ${Math.round(original.length / 1e6)} MB`);

        const copia = await comprimir(original, variante);
        // Escribir y renombrar: un archivo existente siempre está completo.
        const temporal = path.join(directorio, `.${archivo}.tmp`);
        fs.writeFileSync(temporal, copia);
        fs.chmodSync(temporal, 0o644); // lo sirve nginx, con otro usuario
        fs.renameSync(temporal, path.join(directorio, archivo));
        existentes.add(archivo);
        bytesOriginales += original.length;
        bytesCopias += copia.length;
      } catch (err) {
        errores.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  } finally {
    await navegador.cerrar();
  }

  if (bytesOriginales) {
    const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
    console.log(
      `  descargadas ${faltan.length - errores.length} (${conNavegador} con navegador): ` +
        `${mb(bytesOriginales)} MB → ${mb(bytesCopias)} MB`,
    );
  }
  if (errores.length) {
    console.warn(`  ⚠ ${errores.length} imágenes quedan con su URL original:`);
    for (const e of errores.slice(0, 10)) console.warn(`    ${e}`);
    if (errores.length > 10) console.warn(`    … y ${errores.length - 10} más`);
  }

  for (const b of beneficios) {
    const imagen = b.imagen && nombreArchivo(b.imagen, 'imagen');
    const logo = b.logo && nombreArchivo(b.logo, 'logo');
    b.imagenOptimizada = imagen && existentes.has(imagen) ? `${RUTA_PUBLICA}/${imagen}` : null;
    b.logoOptimizado = logo && existentes.has(logo) ? `${RUTA_PUBLICA}/${logo}` : null;
  }

  // Borrar las copias que ya nadie usa (y temporales de una corrida cortada).
  let borradas = 0;
  for (const f of fs.readdirSync(directorio)) {
    if (pedidos.has(f)) continue;
    fs.rmSync(path.join(directorio, f), { force: true });
    borradas++;
  }
  if (borradas) console.log(`  ${borradas} copias sin uso borradas`);
}
