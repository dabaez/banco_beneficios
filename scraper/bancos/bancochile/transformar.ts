/**
 * Normalización de los beneficios de Banco de Chile.
 *
 * Viene estructurado: tarjetas (`Tarjetas Permitidas`), locales con dirección
 * y comuna (`Sucursales`), días y lugares (tags) y la vigencia (`unpublish_at`).
 * Lo demás sale del texto:
 *   - Porcentaje y tipo: del titular ("20%; dto.") o, si está vacío, de la
 *     bajada ("Paga en 4 a 12 cuotas sin interés.").
 *   - Canal: la bajada lo dice casi siempre ("lunes a jueves presencial y online").
 *   - Tope: de la descripción y el legal ("Tope dto. $40.000 por mesa").
 */
import type { Alcance, DiaSemana, TipoBeneficio } from '../../../shared/beneficio.ts';
import { detectarLocalidades, detectarRegiones, normalizar, REGIONES, type Localidad, type Region } from '../../localidades.ts';
import type { BeneficioSinGeo } from '../../tipos.ts';
import { ORIGEN } from './api.ts';
import type { Entrada } from './tipos.ts';

/**
 * Cadenas con más locales que esto (Cruz Verde tiene 723, KFC 147) se tratan
 * como nacionales/regionales sin pines: geocodificar cada local costaría horas
 * de Nominatim y el mapa no gana mucho con cientos de pines de una farmacia.
 */
const MAX_LOCALES = 20;
/** Una cadena presente en al menos tantas regiones se considera nacional. */
const REGIONES_NACIONAL = Math.ceil(Object.keys(REGIONES).length / 2);

const DIAS: Record<string, DiaSemana> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

/**
 * `Tarjetas Permitidas` → tipo, marca y nivel. El nivel es null en las que no
 * restringen nada por sí solas (Gold, Platinum, FAN, la débito común).
 */
const TARJETAS: Record<string, { tipo: 'Crédito' | 'Débito'; marca: 'Visa' | 'Mastercard'; nivel: string | null }> = {
  'visa-credito-infinite': { tipo: 'Crédito', marca: 'Visa', nivel: 'Visa Infinite' },
  'visa-credito-signature': { tipo: 'Crédito', marca: 'Visa', nivel: 'Visa Signature' },
  'visa-credito-platinum': { tipo: 'Crédito', marca: 'Visa', nivel: null },
  'visa-credito-gold': { tipo: 'Crédito', marca: 'Visa', nivel: null },
  'visa-fan-credito': { tipo: 'Crédito', marca: 'Visa', nivel: null },
  'visa-debito-infinite': { tipo: 'Débito', marca: 'Visa', nivel: 'Visa Infinite' },
  'visa-debito-signature': { tipo: 'Débito', marca: 'Visa', nivel: 'Visa Signature' },
  'visa-debito-bch': { tipo: 'Débito', marca: 'Visa', nivel: null },
  'visa-cuenta-fan': { tipo: 'Débito', marca: 'Visa', nivel: null },
  'mastercard-credito-black': { tipo: 'Crédito', marca: 'Mastercard', nivel: 'Mastercard Black' },
  'mastercard-credito-platinum': { tipo: 'Crédito', marca: 'Mastercard', nivel: null },
  'mastercard-credito-dorada': { tipo: 'Crédito', marca: 'Mastercard', nivel: null },
};

/** `category_slug` → nombre en el sitio. "beneficios-y-descuentos" se afina con los tags. */
const CATEGORIAS: Record<string, string> = {
  'restaurantes-y-bares': 'Restaurantes y Bares',
  'beneficios-y-descuentos': 'Marcas y Cuotas',
  salud: 'Salud',
  '40-de-descuento-visa': '40% con todo Visa',
  belleza: 'Belleza',
  delivery: 'Delivery',
  'sabores-gourmet': 'Sabores Gourmet',
  entretencion: 'Entretención',
  deportes: 'Deportes',
  'dolares-premio': 'Dólares Premio',
  musica: 'Música',
  cafeterias: 'Cafeterías',
  sustentable: 'Sustentable',
  viajes: 'Viajes',
  'comida-rapida': 'Comida Rápida',
  mascotas: 'Mascotas',
  cine: 'Cine',
  '50-de-descuento-visa-infinite': '50% con Visa Infinite',
  panoramas: 'Panoramas',
  'catalogo-productos': 'Catálogo',
};

/** Tags que el sitio usa como filtros dentro de "Marcas y Cuotas". */
const CATEGORIAS_TAG: Record<string, string> = {
  'cuotas-sin-interes': 'Cuotas sin interés',
  hogar: 'Hogar',
  servicios: 'Servicios',
  'vestuario-y-calzado': 'Vestuario y Calzado',
};

const ENTIDADES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  uuml: 'ü',
  iexcl: '¡',
  iquest: '¿',
  deg: '°',
  ordm: 'º',
  ordf: 'ª',
};

function decodificar(s: string): string {
  return s
    .replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);?/gi, (m, n) => ENTIDADES[n] ?? m);
}

function limpiar(s: string | null | undefined): string {
  return decodificar(s ?? '')
    .replace(/[\u00a0\u200b\u202a-\u202e]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** HTML del CMS → texto, un párrafo o ítem de lista por línea. */
function textoHtml(html: string | null | undefined): string {
  return limpiar(
    (html ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|div|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

function slug(s: string): string {
  return normalizar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fecha calendario en Chile (YYYY-MM-DD) de un instante ISO. */
function fechaChile(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "Promoción válida hasta el 30 de septiembre 2026." → "2026-09-30". */
function fechaDeTexto(texto: string): string | null {
  const m = normalizar(texto).match(/(\d{1,2}) (?:de )?([a-z]+) (?:de(?:l)? )?(\d{4})/);
  const mes = m ? MESES.indexOf(m[2]) + 1 : 0;
  if (!m || !mes) return null;
  return `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** "20%; dto." → "20% dto."; "Hasta; 25% dto." → "Hasta 25% dto."; "Disfruta 2x1; en entradas" → "Disfruta 2x1 en entradas". */
function titular(tipoBeneficio: string): string {
  const t = limpiar(tipoBeneficio.replace(/;/g, ' '))
    .replace(/\bdto\b\.?/gi, 'dto.')
    .replace(/\s+\./g, '.');
  return capitalizar(t);
}

function tipoYDescuento(cabecera: string, bajada: string, categoria: string): { tipo: TipoBeneficio; descuento: number | null } {
  const t = normalizar(`${cabecera} ${cabecera ? '' : bajada}`);
  if (/cuotas/.test(t)) return { tipo: 'cuotas', descuento: null };
  // Canje con Dólares Premio (las millas del banco): "Consumo por $50.000", "Hasta 25% canje DP".
  if (categoria === 'dolares-premio' || /canje dp|dolares premio/.test(t)) return { tipo: 'millas', descuento: null };
  const pct = t.match(/(\d{1,3})\s*%/);
  const porcentaje = pct ? Number(pct[1]) : null;
  const tipo: TipoBeneficio = /cashback/.test(t) ? 'cashback' : 'descuento';
  if (porcentaje != null && porcentaje > 0 && porcentaje <= 100) return { tipo, descuento: porcentaje };
  if (/cashback|descuento|dto/.test(t)) return { tipo, descuento: null };
  return { tipo: 'otro', descuento: null };
}

function detectarTope(texto: string): number | null {
  const m = normalizar(texto).match(
    /tope (?:maximo )?(?:de )?(?:(?:dto|descuento|dcto)\.? )?(?:de )?(?:por \w+ )?\$ ?(\d{1,3}(?:\.\d{3})+|\d{4,})/,
  );
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Días desde los tags; si no hay, desde la bajada ("lunes a jueves y sábados"). */
function diasDe(tags: string[], bajada: string): DiaSemana[] {
  const tagsNorm = tags.map(normalizar);
  if (tagsNorm.includes('todos-los-dias')) return [];
  const porTag = tagsNorm.map((t) => DIAS[t]).filter((d) => d !== undefined);
  if (porTag.length) return [...new Set(porTag)].sort();

  const t = normalizar(bajada).replace(/(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s\b/g, '$1');
  if (/todos los dias/.test(t)) return [];
  const dias = new Set<DiaSemana>();
  for (const m of t.matchAll(/(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?: a (lunes|martes|miercoles|jueves|viernes|sabado|domingo))?/g)) {
    const desde = DIAS[m[1]];
    const hasta = m[2] ? DIAS[m[2]] : desde;
    // Rango que cruza el fin de semana ("viernes a domingo").
    for (let d = desde; ; d = ((d + 1) % 7) as DiaSemana) {
      dias.add(d);
      if (d === hasta) break;
    }
  }
  return [...dias].sort();
}

/**
 * Tarjetas del beneficio en términos de `BANCOS.bancochile.tarjetas`:
 *   - "Crédito"/"Débito" según qué tipos admite.
 *   - Premium: si una marca queda fuera (los "40% con todo Visa" excluyen
 *     Mastercard) se listan la marca admitida y sus niveles; si solo sirven
 *     niveles altos (Infinite, Signature, Black) se listan solo esos.
 */
function tarjetasDe(permitidas: string[] | null | undefined): { tarjetas: string[]; exclusivo: boolean } {
  const ids = (permitidas ?? []).map(normalizar);
  if (!ids.length || ids.includes('all')) return { tarjetas: ['Crédito', 'Débito'], exclusivo: false };
  const cards = ids.map((i) => TARJETAS[i]).filter(Boolean);
  if (!cards.length) return { tarjetas: ['Crédito', 'Débito'], exclusivo: false };

  const base = (['Crédito', 'Débito'] as const).filter((t) => cards.some((c) => c.tipo === t));
  const marcaAbierta = (m: string) => cards.some((c) => c.marca === m && !c.nivel);
  const abiertas = (['Visa', 'Mastercard'] as const).filter(marcaAbierta);
  if (abiertas.length === 2) return { tarjetas: [...base], exclusivo: false };

  const niveles = [...new Set(cards.map((c) => c.nivel).filter((n): n is string => !!n))];
  return { tarjetas: [...base, ...abiertas, ...niveles], exclusivo: abiertas.length === 0 };
}

/** Un local de `Sucursales`: dirección y comuna, ubicando la región en la fila. */
function localDeFila(fila: string): { localidad: Localidad | null; region: Region | null } {
  const campos = limpiar(fila)
    .split(';')
    .map((c) => c.trim())
    .map((c) => (/^vacio$/i.test(c) ? '' : c));
  // La región es la ancla: la dirección va antes y la comuna después.
  // Casi siempre es el tercer campo; si sobra o falta uno al principio, se busca.
  const iRegion = regionDeCampo(campos[2] ?? '') ? 2 : campos.findIndex((c) => regionDeCampo(c) !== null);
  if (iRegion < 0) return { localidad: null, region: null };
  const region = regionDeCampo(campos[iRegion]);
  // Algunas filas van "calle;local 106;región;comuna": el campo previo a la región
  // es solo el número de local y la calle está uno antes.
  const previos = campos.slice(Math.max(0, iRegion - 2), iRegion).reverse();
  const direccion = previos.find((c) => c && !UNIDAD.test(c)) ?? '';
  const comunaTexto = campos[iRegion + 1] ?? '';

  // La comuna declarada manda; si no se reconoce, se busca en la dirección
  // ("MALL PASEO PUERTO VARAS LOCAL 208"), siempre dentro de la región de la fila.
  const candidatas = [comunaTexto, direccion].flatMap((t) => detectarLocalidades([t]).localidades);
  const l = candidatas.find((c) => !region || c.region === region);
  if (!l) return { localidad: null, region };

  const dir = limpiarDireccion(direccion);
  return { localidad: /\d/.test(dir) ? { ...l, direccion: dir } : l, region };
}

function regionDeCampo(c: string): Region | null {
  const n = normalizar(c);
  if (!n || n.length > 60) return null;
  if (n === 'rm') return 'Metropolitana';
  // Solo campos que son una región, no direcciones con "Región" en medio.
  if (!/^(region|metropolitana|bio|maule|valpara|antofagasta|coquimbo|atacama|tarapaca|nuble|los |la |magallanes|aysen|arica|libertador|o'?higgins)/.test(n)) {
    return null;
  }
  return detectarRegiones([n.replace(/bio[\s-]+bio/, 'biobio')])[0] ?? null;
}

/** Campo que es solo un local u oficina: "Local 106-107", "of 2", "Oficina #902". */
const UNIDAD = /^(?:local(?:es)?|loc\.?|of\.?|oficina|piso|depto\.?|dpto\.?|m[oó]dulo|isla)\b/i;

/** Quita "local 5", "#", "N°" y otros restos para buscar la dirección en OSM. */
function limpiarDireccion(s: string): string {
  return s
    .replace(
      /\b(?:local(?:es)?|loc\.?|of\.?|oficina|piso|depto\.?|dpto\.?|m[oó]dulo)\s*(?:n[°º]?\s*)?#?\s*[a-z]?-?\d+[a-z]?(?:\s*(?:-|\/|y)\s*[a-z]?\d+[a-z]?)*\b/gi,
      '',
    )
    .replace(/\s*[#]\s*/g, ' ')
    .replace(/\bn[°º]\s*/gi, '')
    .replace(/(\d)\.(\d{3})\b/g, '$1$2')
    .replace(/[\s,.;–-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tags que no son lugares ni días: campañas y rubros. */
function esTagDeLugar(t: string): boolean {
  return !/[0-9]/.test(t) && !t.includes('-') && !(t in DIAS);
}

export function transformar(e: Entrada, indice: number): BeneficioSinGeo | null {
  const f = e.fields;
  const nombre = limpiar(f.Titulo || e.meta.name);
  if (!nombre || !e.meta.slug) return null;

  const cabecera = titular(f['Tipo Beneficio'] ?? '');
  const bajada = capitalizar(limpiar(f.Extracto?.replace(/;/g, '')));
  const descripcion = textoHtml(f.Descripcion);
  const legal = limpiar([f['Condiciones Comerciales'], f.Vigencia].filter(Boolean).join('\n'));
  const categoriaSlug = e.meta.category_slug ?? '';
  const tags = (e.meta.tags ?? []).map(normalizar);

  const { tipo, descuento } = tipoYDescuento(cabecera, bajada, categoriaSlug);
  const { tarjetas, exclusivo } = tarjetasDe(f['Tarjetas Permitidas']);
  const dias = diasDe(tags, bajada);

  const categorias = [
    ...new Set([
      CATEGORIAS[categoriaSlug] ?? capitalizar(categoriaSlug.replace(/-/g, ' ')),
      ...tags.map((t) => CATEGORIAS_TAG[t]).filter(Boolean),
      ...(tipo === 'cuotas' ? ['Cuotas sin interés'] : []),
    ]),
  ].filter(Boolean);

  // Locales.
  const filas = [...(f.Sucursales ?? '').matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);
  const locales = filas.map(localDeFila);
  const regionesLocales = [...new Set(locales.flatMap((l) => [l.region, l.localidad?.region]).filter((r): r is Region => !!r))];
  const esCadena = filas.length > MAX_LOCALES;

  // Canal: la bajada lo dice casi siempre; si no, la descripción; si no, los locales.
  const canal = (t: string) => {
    const n = normalizar(t);
    return {
      online: /\bonline\b|compra web|sitio web|en la web|\bapp\b|e-?commerce|delivery|\bweb\b/.test(n),
      presencial: /presencial|en tienda|en local/.test(n),
    };
  };
  let { online, presencial } = canal(`${bajada} ${cabecera}`);
  if (!online && !presencial) ({ online, presencial } = canal(descripcion));
  if (categoriaSlug === 'delivery') online = true;
  if (!online && !presencial) presencial = true;
  if (!presencial && filas.length && !online) presencial = true;

  const todoChile = tags.includes('todo-chile');
  let localidades: Localidad[] = [];
  let regiones: Region[] = [];
  if (presencial && !esCadena) {
    const porClave = new Map<string, Localidad>();
    for (const { localidad } of locales) {
      if (localidad) porClave.set(`${localidad.comuna}|${localidad.sector ?? ''}|${localidad.direccion ?? ''}`, localidad);
    }
    // Sin locales, los tags traen la comuna ("valdivia", "las condes"). Los que
    // son nombre de región ("valparaíso", "los lagos") se toman solo como región.
    if (!porClave.size && !todoChile) {
      const lugares = tags.filter(esTagDeLugar).filter((t) => !detectarRegiones([t]).length);
      for (const l of detectarLocalidades(lugares).localidades) porClave.set(`${l.comuna}|${l.sector ?? ''}|`, l);
    }
    localidades = [...porClave.values()];
  }
  const regionesTags = detectarRegiones(tags.filter(esTagDeLugar));
  const cadenaNacional = esCadena && (todoChile || regionesLocales.length >= REGIONES_NACIONAL);
  if (!todoChile && !cadenaNacional) {
    regiones = [...new Set<Region>([...regionesTags, ...regionesLocales, ...localidades.map((l) => l.region)])];
  }

  let alcance: Alcance;
  if (localidades.length) alcance = 'local';
  else if (online && !presencial) alcance = 'online';
  else if (todoChile || cadenaNacional) alcance = 'nacional';
  else if (regiones.length) alcance = 'regional';
  else alcance = 'desconocido';

  const termino = fechaChile(e.meta.unpublish_at);
  const terminoTexto = termino ? null : fechaDeTexto(f.Vigencia ?? '');

  const sitio = limpiar(f['Sitio web']);
  const acerca = [sitio && `Sitio web: ${/^https?:/.test(sitio) ? sitio : `https://${sitio}`}`, limpiar(f.Telefono) && `Teléfono: ${limpiar(f.Telefono)}`]
    .filter(Boolean)
    .join('\n');

  return {
    beneficio: {
      banco: 'bancochile',
      id: `bancochile:${e.meta.slug}`,
      slug: e.meta.slug,
      titulo: cabecera || bajada || nombre,
      subtitulo: cabecera ? bajada : '',
      descripcion: [descripcion || bajada, acerca].filter(Boolean).join('\n\n'),
      legal,
      link: `${ORIGEN}/personas/beneficios/detalle/${e.meta.slug}`,
      comercio: { id: slug(nombre), nombre },
      imagen: f.Portada?.url || null,
      logo: f.Logo?.url || null,
      categorias,
      tags: [...new Set([...tags, ...(f.Keywords ?? '').split(';').map(normalizar).filter(Boolean)])],
      tipo,
      descuento,
      tope: descuento != null ? detectarTope(`${descripcion}\n${legal}`) : null,
      tarjetas,
      dias: dias.length === 7 ? [] : dias,
      presencial,
      online,
      // Última publicación: el CMS no guarda el inicio de la promoción.
      fechaInicio: e.meta.published_at || e.meta.created_at || new Date().toISOString(),
      // `unpublish_at` es cuando el sitio deja de mostrarlo: vale hasta el final de ese día.
      fechaTermino: termino ? `${termino}T23:59:59.000Z` : terminoTexto ? `${terminoTexto}T23:59:59.000Z` : null,
      ...(terminoTexto ? { fechaTerminoAproximada: true } : {}),
      soloAdultos: false,
      exclusivo,
      prioridad: indice,
      alcance,
      regiones,
    },
    localidades,
  };
}
