/**
 * Normalización de los descuentos de Banco Falabella.
 *
 * Casi todo viene estructurado desde Contentful: días, vigencia, tarjetas,
 * regiones, canal y categorías. Lo que no:
 *   - El porcentaje: `discount` vale 1 en los beneficios que no son un %
 *     (canjes, montos fijos, cuotas), así que manda el titular de la tarjeta
 *     ("Hasta" / "40%" / "Sin Tope").
 *   - Las ubicaciones: `locations` viene vacío; los locales van en la
 *     descripción ("Gerónimo de Alderete 1579, Vitacura." o "Mall Plaza Vespucio: lunes a jueves").
 */
import type { Alcance, DiaSemana, TipoBeneficio } from '../../../shared/beneficio.ts';
import { BANCOS } from '../../../shared/bancos.ts';
import { detectarLocalidades, detectarRegiones, normalizar, REGIONES, type Localidad, type Region } from '../../localidades.ts';
import type { BeneficioSinGeo } from '../../tipos.ts';
import { ORIGEN } from './api.ts';
import type { BeneficioCrudo, NodoRichText } from './tipos.ts';

const DIAS: Record<string, DiaSemana> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

/** `creditCards` → tarjetas de `BANCOS.falabella`. */
const TARJETAS: Record<string, string> = {
  'cmr mastercard': 'Crédito',
  'cmr mastercard premium': 'CMR Premium',
  'cmr mastercard elite': 'CMR Elite',
  'tarjeta debito banco falabella': 'Débito',
};

/**
 * Categorías del sitio. "Regiones" y "Elite" no son rubros (lo primero ya está
 * en `regiones` y lo segundo en `tarjetas`), y "CMR Puntos" es el nombre viejo de Fpuntos.
 */
const CATEGORIAS: Record<string, string | null> = {
  regiones: null,
  elite: null,
  'exclusivo elite': null,
  'cmr puntos': 'Fpuntos',
  'pago en cuotas': 'Cuotas sin interés',
};

const TODAS_LAS_REGIONES = Object.keys(REGIONES).length;

const BLOQUES = new Set(['paragraph', 'list-item', 'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6', 'blockquote']);

/** Rich text de Contentful → texto plano, un bloque por línea. */
function textoRich(n: NodoRichText | null | undefined): string {
  if (!n) return '';
  if (n.value != null) return n.value;
  const hijos = (n.content ?? []).map(textoRich).join('');
  return BLOQUES.has(n.nodeType) ? `${hijos}\n` : hijos;
}

function limpiar(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function absoluta(u: string | null | undefined): string | null {
  if (!u) return null;
  return u.startsWith('//') ? `https:${u}` : new URL(u, ORIGEN).href;
}

function slug(s: string): string {
  return normalizar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Fecha calendario en Chile (YYYY-MM-DD). Sin zona ("2026-09-03T00:00") ya es hora local. */
function fechaChile(s: string | null | undefined): string | null {
  if (!s) return null;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA formatea como YYYY-MM-DD.
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

function parsearPesos(s: string): number | null {
  const n = Number(s.replace(/\./g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * El titular de la tarjeta en una frase: "Hasta" / "40%" / "Sin Tope" →
 * "Hasta 40% dcto. sin tope"; "Classic a" / "5.000" / "App Copec" → "Classic a $5.000 App Copec".
 */
function titular(top: string, centro: string, abajo: string, discount: number | undefined): string {
  let medio = centro.trim();
  // Un monto a secas ("5.000") es precio en pesos, salvo que se hable de Fpuntos.
  if (/^\d{1,3}(?:\.\d{3})+$/.test(medio) && !/puntos/i.test(`${top} ${abajo}`)) medio = `$${medio}`;
  // "Hasta 40 Sin Tope": al editor se le olvidó el %.
  if (/^\d{1,2}$/.test(medio) && discount === Number(medio)) medio = `${medio}%`;
  let t = limpiar([top, medio, abajo].join(' '));
  if (t === t.toUpperCase()) t = t.toLowerCase(); // "6 CUOTAS SIN INTERÉS"
  t = t
    .replace(/\b(sin tope|sin inter[eé]s|descuento|dcto|cuotas)\b/gi, (m) => m.toLowerCase())
    .replace(/\bdcto\b\.?/g, 'dcto.')
    .replace(/\btope \$?(\d)/i, 'tope $$$1'); // "Tope 40.000"
  // En "12 cuotas 0.89%" el % es la tasa, no un descuento.
  if (/%/.test(t) && !/dcto|descuento|cuotas/.test(t)) t = t.replace(/(\d+%)/, '$1 dcto.');
  return capitalizar(t);
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function tipoYDescuento(textoTitular: string): { tipo: TipoBeneficio; descuento: number | null } {
  const t = normalizar(textoTitular);
  if (/cuotas/.test(t)) return { tipo: 'cuotas', descuento: null };
  const pct = t.match(/(\d{1,3})\s*%/);
  const porcentaje = pct ? Number(pct[1]) : null;
  if (porcentaje != null && porcentaje > 0 && porcentaje <= 100) return { tipo: 'descuento', descuento: porcentaje };
  if (/descuento|dcto/.test(t)) return { tipo: 'descuento', descuento: null };
  return { tipo: 'otro', descuento: null };
}

function detectarTope(abajo: string, texto: string): number | null {
  if (/sin tope/.test(normalizar(abajo))) return null;
  const m = normalizar(`${abajo} ${texto}`).match(/tope (?:maximo )?(?:de )?\$? ?(\d{1,3}(?:\.\d{3})+|\d{4,})/);
  return m ? parsearPesos(m[1]) : null;
}

function tarjetasDe(creditCards: string[] | null | undefined): string[] {
  const { base, premium } = BANCOS.falabella.tarjetas;
  const orden: readonly string[] = [...base, ...premium];
  const todas = [...new Set((creditCards ?? []).map((c) => TARJETAS[normalizar(c)]).filter(Boolean))].sort(
    (a, b) => orden.indexOf(a) - orden.indexOf(b),
  );
  // Si sirve la CMR normal, los niveles superiores no restringen nada.
  const esPremium = (t: string) => (premium as readonly string[]).includes(t);
  if (todas.includes('Crédito')) return todas.filter((t) => !esPremium(t));
  // Solo niveles premium: son todos de crédito.
  if (todas.some(esPremium)) return ['Crédito', ...todas.filter((t) => t !== 'Crédito')];
  return todas;
}

/** Abreviaturas tras las que un punto no cierra la frase ("Av. Pdte. Kennedy"). */
const ABREVIATURAS = new Set(['avda', 'pdte', 'gral', 'dpto', 'depto', 'sta', 'sto', 'nro', 'ing', 'dr', 'dra']);

/** Corta una línea en frases y en direcciones unidas por "y" ("… Las Condes y Avenida Providencia 1984"). */
function tramosDeLinea(linea: string): string[] {
  const frases: string[] = [];
  let desde = 0;
  for (const m of linea.matchAll(/\.\s+(?=[A-ZÁÉÍÓÚÑ])/g)) {
    const palabra = linea.slice(desde, m.index).match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]+$/)?.[0] ?? '';
    // "Av.", "S.J.E." y "Pdte." no terminan una frase.
    if (palabra.length < 3 || palabra === palabra.toUpperCase() || ABREVIATURAS.has(normalizar(palabra))) continue;
    frases.push(linea.slice(desde, m.index));
    desde = m.index + m[0].length;
  }
  frases.push(linea.slice(desde));
  return frases.flatMap((f) => f.split(/\s+y\s+(?=(?:Av\.?|Avenida|Calle)\s)/));
}

/** Quita el "local 363 A", "piso 1", el código postal y la puntuación final de una dirección. */
function limpiarDireccion(s: string): string {
  return s
    .replace(/\b(?:local|loc\.?|piso|of\.?|oficina)\s*\d+[a-z]?(?:\s+[A-Z]\b)?/gi, '')
    .replace(/\btorre\s+\w+(?:\s+[A-Z]\b)?(?:\s+\d+)?/gi, '') // "Torre Oriente B 15"
    .replace(/\b\d{7}\b/g, '') // código postal: "7630000 Vitacura"
    .replace(/(\d)\.(\d{3})\b/g, '$1$2') // "3.900" → "3900"
    .replace(/\s*,\s*(?=,|$)/g, '')
    .replace(/[\s,.;–-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calle y número dentro de un tramo como
 *   "Sicily: Alonso de Córdova 4226, 7630000 Vitacura, Región Metropolitana"
 *   "Boulevard Parque Arauco - Av. Pdte. Kennedy 5413, local 363 A, piso 1, Las Condes"
 *   "Alto Las Condes (Av Presidente Kennedy Lateral 9001)"
 *   "Av. Santa María, 5870, Torre Oriente B 15, Vitacura"
 */
function calleDeTramo(tramo: string): string | null {
  const parentesis = tramo.match(/\(([^)]*\d[^)]*)\)/);
  let t = parentesis ? parentesis[1] : tramo;
  t = t.replace(/^.*?:\s*/, '').replace(/^.*\s[-–]\s/, '');
  const partes = t.split(',').map((p) => p.trim());
  // "Av. Santa María, 5870": el número quedó en su propia parte.
  for (let i = 1; i < partes.length; i++) {
    if (/^\d{1,5}$/.test(partes[i])) partes.splice(i - 1, 2, `${partes[i - 1]} ${partes[i]}`);
  }
  const calle = partes.find((p) => /[a-záéíóúñ]{3}.*\s\d{1,5}[a-z]?\b/i.test(p) && !/^\d/.test(p));
  if (!calle || calle.length > 70) return null;
  const limpia = limpiarDireccion(calle);
  return /\d/.test(limpia) ? limpia : null;
}

/**
 * Locales de la descripción. Cada línea puede traer varios ("Gerónimo de
 * Alderete 1579, Vitacura. Irarrázaval 1520, Ñuñoa." o "… Las Condes y Avenida
 * Providencia 1984, Providencia"), así que se corta en tramos y cada tramo que
 * nombre una comuna o sector da una localidad, con su dirección si la tiene.
 */
function localidadesDeTexto(texto: string): { localidades: Localidad[]; nacional: boolean } {
  const porClave = new Map<string, Localidad>();
  let nacional = false;
  for (const linea of texto.split('\n')) {
    for (const tramo of tramosDeLinea(linea)) {
      const geo = detectarLocalidades([tramo]);
      nacional ||= geo.nacional;
      if (!geo.localidades.length) continue;
      let localidades = geo.localidades;
      let calle = calleDeTramo(tramo);
      if (calle) {
        // El nombre de la calle puede contener una comuna ("Pedro de Valdivia 2573, Ñuñoa"):
        // la comuna del local es la que queda fuera de la calle.
        const nombreCalle = calle.replace(/\s*\d.*$/, '');
        const resto = detectarLocalidades([tramo.replace(nombreCalle, ' ')]).localidades;
        if (resto.length) localidades = resto;
        if (localidades.length !== 1) calle = null;
      }
      for (const l of localidades) {
        const loc = calle ? { ...l, direccion: calle } : l;
        porClave.set(`${loc.comuna}|${loc.sector ?? ''}|${loc.direccion ?? ''}`, loc);
      }
    }
  }
  // Sin dirección sobra una comuna o sector si ya hay un local más preciso ahí.
  const localidades = [...porClave.values()];
  const conDireccion = localidades.filter((l) => l.direccion);
  const conSector = localidades.filter((l) => l.sector);
  return {
    localidades: localidades.filter(
      (l) =>
        l.direccion ||
        (l.sector
          ? !conDireccion.some((x) => x.comuna === l.comuna && x.sector === l.sector)
          : !conDireccion.some((x) => x.comuna === l.comuna) && !conSector.some((x) => x.comuna === l.comuna)),
    ),
    nacional,
  };
}

export function transformar({ tarjeta: t, detalle: d }: BeneficioCrudo, indice: number): BeneficioSinGeo | null {
  const c = t.benefitCard;
  const nombre = limpiar(d?.commerceName || t.benefitTitle || c.title);
  if (!nombre || !c.linkUrl) return null;

  const permalink = d?.permalink || c.linkUrl.split('/').filter(Boolean).pop()!;
  const cabecera = titular(c.topDiscountText ?? '', c.centerDiscountText ?? '', c.bottomDiscountText ?? '', t.discount);
  const bajada = limpiar(c.description);
  const descripcionFicha = limpiar(textoRich(d?.detailBanner1));
  const acerca = limpiar(d?.commerceInfoDescription);
  const legal = limpiar(d?.legalText);

  const { tipo, descuento } = tipoYDescuento(cabecera);

  const dias = [...new Set((c.discountDays ?? []).map((x) => DIAS[normalizar(x)]).filter((x) => x !== undefined))].sort();

  const tarjetas = tarjetasDe(d?.creditCards ?? t.creditCards);
  const premium: readonly string[] = BANCOS.falabella.tarjetas.premium;

  const categoriasCrudas = d?.relatedCategory ?? t.quickFilters ?? [];
  const categorias = [
    ...new Set(
      categoriasCrudas
        .map((x) => limpiar(x))
        .map((x) => (normalizar(x) in CATEGORIAS ? CATEGORIAS[normalizar(x)] : x))
        .filter((x): x is string => !!x),
    ),
  ];

  // Canal: `benefitsMode` es confiable; sin ficha, la bajada suele decirlo ("Exclusivo online").
  const modos = (d?.benefitsMode ?? []).map(normalizar);
  let online: boolean;
  let presencial: boolean;
  if (modos.length) {
    online = modos.includes('online') || modos.includes('delivery');
    presencial = modos.includes('presencial');
  } else {
    const b = normalizar(bajada);
    online = /online|web|app\b/.test(b);
    presencial = /presencial/.test(b) || !online;
  }

  // Regiones: el sitio marca las 16 (con duplicados) cuando vale en todo Chile.
  const regionesMarcadas = detectarRegiones(d?.region ?? t.region ?? []);
  const todoChile = regionesMarcadas.length >= TODAS_LAS_REGIONES;

  // Locales: de la descripción y de la bajada ("Presencial en Osorno"). Nunca del
  // texto "acerca de" (habla de la historia del comercio) ni del legal.
  const geo = presencial ? localidadesDeTexto(`${bajada}\n${descripcionFicha}`) : { localidades: [], nacional: false };
  // Una localidad fuera de las regiones marcadas es casi siempre ruido de la
  // descripción ("Mall Arauco Maipú", "Mercado Bulnes"). La bajada ("Presencial
  // en Pucon") sí es confiable: a veces la región marcada es la que está mal.
  const enBajada = new Set(detectarLocalidades([bajada]).localidades.map((l) => l.comuna));
  const localidades =
    todoChile || !regionesMarcadas.length
      ? geo.localidades
      : geo.localidades.filter((l) => regionesMarcadas.includes(l.region) || enBajada.has(l.comuna));

  const regiones: Region[] = todoChile ? [] : [...new Set<Region>([...regionesMarcadas, ...localidades.map((l) => l.region)])];

  let alcance: Alcance;
  if (localidades.length) alcance = 'local';
  else if (online && !presencial) alcance = 'online';
  else if (todoChile || geo.nacional) alcance = 'nacional';
  else if (regiones.length) alcance = 'regional';
  else alcance = 'desconocido';

  const inicio = fechaChile(c.initDate);
  const termino = fechaChile(c.endDate || t.limitDate);

  const tags = [
    ...categoriasCrudas,
    ...(t.quickFilters ?? []),
    ...(c.isNew ? ['nuevo'] : []),
    ...(t.highlighted ? ['destacado'] : []),
  ].map(normalizar);

  return {
    beneficio: {
      banco: 'falabella',
      id: `falabella:${permalink}`,
      slug: permalink,
      titulo: cabecera || capitalizar(bajada) || nombre,
      subtitulo: bajada,
      descripcion: [descripcionFicha || bajada, acerca].filter(Boolean).join('\n\n'),
      legal,
      // La ficha del banco tiene las condiciones y el enlace al comercio.
      link: new URL(c.linkUrl, ORIGEN).href,
      comercio: { id: slug(nombre), nombre },
      imagen: absoluta(c.imageCard),
      logo: absoluta(c.logoCard),
      categorias,
      tags: [...new Set(tags)],
      tipo,
      descuento,
      tope: descuento != null ? detectarTope(c.bottomDiscountText ?? '', `${descripcionFicha} ${legal}`) : null,
      tarjetas,
      dias: dias.length === 7 ? [] : dias,
      presencial,
      online,
      fechaInicio: inicio ? `${inicio}T00:00:00.000Z` : new Date().toISOString(),
      // Fecha exacta del CMS (no texto libre): vale hasta el final de ese día.
      fechaTermino: termino ? `${termino}T23:59:59.000Z` : null,
      soloAdultos: false,
      exclusivo: tarjetas.some((x) => premium.includes(x)),
      // Orden del sitio (destacados primero).
      prioridad: indice,
      alcance,
      regiones,
    },
    localidades,
  };
}
