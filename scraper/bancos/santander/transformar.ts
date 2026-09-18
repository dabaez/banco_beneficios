/**
 * Normalización de las promociones de Santander.
 *
 * A diferencia de BCI, el CMS de Santander no entrega el beneficio estructurado:
 * `discount`, `start_date` y `end_date` vienen vacíos en las 308 promociones.
 * Lo que sí está estructurado son los `tags` (uno por día, categoría, tarjeta y
 * región), así que la mayor parte del mapeo sale de ahí y solo el porcentaje y
 * la vigencia se extraen del texto.
 */
import type { Alcance, DiaSemana, TipoBeneficio } from '../../../shared/beneficio.ts';
import { detectarLocalidades, detectarRegiones, normalizar, type Localidad, type Region } from '../../localidades.ts';
import { BANCOS } from '../../../shared/bancos.ts';
import type { BeneficioSinGeo } from '../../tipos.ts';
import type { PromocionApi } from './tipos.ts';

const DIAS: Record<string, DiaSemana> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

/** Tags `cat-*` → nombre de categoría para mostrar. */
const CATEGORIAS: Record<string, string> = {
  'cat-sabores': 'Restaurantes',
  'cat-descuentos': 'Descuentos',
  'cat-cuotas-sin-interes': 'Cuotas sin interés',
  'cat-multiplica-millas': 'Millas',
  'cat-verdes': 'Sustentables',
  'cat-musica': 'Música',
  'cat-otros': 'Otros',
};

/** Tags de tarjeta → nombres de `BANCOS.santander.tarjetas`. Respaldo de `tarjetasDesdeTexto`. */
const TARJETAS: Record<string, string[]> = {
  'tarjetas-credito': ['Crédito'],
  'tarjeta-credito': ['Crédito'],
  'tarjetas-debito': ['Débito'],
  // Life es una débito Santander: como filtro no distingue nada de "Débito".
  'life-y-debito': ['Débito'],
  'todas-las-tarjetas': ['Crédito', 'Débito'],
  amex: ['American Express'],
  'exclusivo-amex': ['American Express'],
  amexforfoodies: ['American Express'],
  'wm-limited': ['WorldMember Limited'],
  'exclusivo-limited': ['WorldMember Limited'],
  empresas: ['Empresas'],
};

/** Tarjetas premium según cómo las nombra el texto (con las erratas observadas). */
const PREMIUM_TEXTO: [string, RegExp][] = [
  ['American Express', /american express|\bamex\b/],
  ['WorldMember Limited', /\bwo?r?l?d ?member/], // también "Woldmember"
];

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function limpiar(s: string | undefined | null): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ') // el CMS devuelve HTML en description/conditions
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function campo(p: PromocionApi, nombre: string): string {
  return limpiar(p.custom_fields?.[nombre]?.value);
}

/** Los meses vienen con erratas ("novimbre"), así que se comparan por prefijo. */
function indiceMes(nombre: string): number {
  return MESES.findIndex((m) => m.slice(0, 4) === nombre.slice(0, 4));
}

/**
 * Fecha en texto libre → ISO. Formatos observados en "Vigencia":
 *   "Hasta el 30 de septiembre de 2026."
 *   "Desde el 12 de septiembre hasta el 22 de septiembre de 2026"
 *   "Desde el 01 de junio al 30 de noviembre de 2026"
 *   "Hasta el 31 de diciembre de 2026 con tu tarjeta activa"
 * El año es opcional; si falta se asume el del final del texto o el año en curso.
 */
function fechaDesdeTexto(texto: string, palabra: 'hasta' | 'desde', ahora: Date): string | null {
  const t = normalizar(texto);
  // El término también se escribe "al 30 de noviembre".
  const prefijo = palabra === 'hasta' ? '(?:hasta\\s+(?:el\\s+)?|al\\s+)' : 'desde\\s+(?:el\\s+)?';
  const re = new RegExp(`${prefijo}(\\d{1,2})\\s+de\\s+([a-zñ]+)(?:\\s+de\\s+(\\d{4}))?`);
  const m = t.match(re);
  if (!m) return null;

  const dia = Number(m[1]);
  const mes = indiceMes(m[2]);
  if (mes < 0 || dia < 1 || dia > 31) return null;

  // Sin año explícito: usar el último año que aparezca en el texto, si no el actual.
  const anioTexto = m[3] ?? t.match(/\b(20\d{2})\b/)?.[1];
  const anio = anioTexto ? Number(anioTexto) : ahora.getUTCFullYear();

  const d = new Date(Date.UTC(anio, mes, dia, 23, 59, 59));
  if (d.getUTCMonth() !== mes) return null; // ej. "31 de febrero"
  return d.toISOString();
}

/**
 * Tarjetas según la frase "Exclusivo con tus Tarjetas de Crédito Santander
 * American Express" de la descripción. Es más confiable que los tags: hay
 * promociones con tag `amex` cuyo texto dice WorldMember Limited.
 *
 * La frase puede listar varias tarjetas ("American Express y tarjeta de crédito
 * Santander"): si alguna es una tarjeta normal, no hay restricción premium.
 * `null` si el texto no trae la frase o no nombra ninguna tarjeta reconocible.
 */
function tarjetasDesdeTexto(texto: string): string[] | null {
  const m = texto.match(
    /exclusiv[oa] (?:para clientes que paguen |pagando )?con (?:tus?|las?) (?:nuevas? )?(tarjetas? .*?)(?= valid[oa]| pide| indicadas|\.|$)/,
  );
  if (!m) return null;

  const base = new Set<string>();
  const premium = new Set<string>();
  let hayNormal = false;
  for (const parte of m[1].split(/\s+(?:y|e|o)\s+|,\s*/)) {
    // "tarjeta de crédito Santander Empresas" es su propia tarjeta, no la de crédito personal.
    if (/empresas/.test(parte)) {
      base.add('Empresas');
      hayNormal = true;
      continue;
    }
    if (/credito/.test(parte)) base.add('Crédito');
    if (/debito/.test(parte)) base.add('Débito');
    const nombradas = PREMIUM_TEXTO.filter(([, re]) => re.test(parte)).map(([nombre]) => nombre);
    if (nombradas.length) nombradas.forEach((t) => premium.add(t));
    else hayNormal = true;
  }
  // Las premium de Santander son todas de crédito.
  if (premium.size && !hayNormal) base.add('Crédito');
  const tarjetas = [...base, ...(hayNormal ? [] : premium)];
  return tarjetas.length ? tarjetas : null;
}

function detectarTipoYDescuento(tags: Set<string>, texto: string): { tipo: TipoBeneficio; descuento: number | null } {
  // "50% dcto", "Hasta 50% descuento", "40% de dcto." — el % explícito manda.
  const pct = texto.match(/(\d{1,3})\s*%/);
  const porcentaje = pct ? Number(pct[1]) : null;
  const valido = porcentaje != null && porcentaje > 0 && porcentaje <= 100 ? porcentaje : null;

  if (tags.has('cat-cuotas-sin-interes') || /cuotas sin inter/.test(texto)) {
    return { tipo: 'cuotas', descuento: null };
  }
  if (/cashback/.test(texto)) return { tipo: 'cashback', descuento: valido };
  // Muchas promos de la categoría "millas" son en realidad un descuento que
  // además acumula millas ("40% dcto. ... y acumula 1 Milla LATAM Pass"):
  // si hay un porcentaje explícito, eso es lo que le sirve al usuario.
  if (valido != null) return { tipo: 'descuento', descuento: valido };
  if (tags.has('cat-multiplica-millas') || /\bmillas?\b/.test(texto)) return { tipo: 'millas', descuento: null };
  if (tags.has('cat-descuentos') || tags.has('cat-sabores')) return { tipo: 'descuento', descuento: null };
  return { tipo: 'otro', descuento: null };
}

function parsearPesos(s: string): number | null {
  const n = Number(s.replace(/\./g, '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function detectarTope(texto: string): number | null {
  const m = texto.match(/tope (?:maximo )?(?:de )?(?:\$|clp) ?([\d.,]+)/);
  return m ? parsearPesos(m[1]) : null;
}

export function transformar(p: PromocionApi, indice: number, ahora = new Date()): BeneficioSinGeo | null {
  const tags = new Set((p.tags ?? []).map((t) => normalizar(String(t))));
  if (!p.title?.trim()) return null;

  // En Santander el `title` es el comercio y la "bajada" es la oferta.
  const comercio = limpiar(p.title);
  const bajada = campo(p, 'Bajada externa') || campo(p, 'Bajada interna') || limpiar(p.excerpt);
  const vigencia = campo(p, 'Vigencia');
  const descripcion = limpiar(p.description);
  const legal = limpiar(p.conditions);

  const textoCorto = normalizar(`${comercio} ${bajada}`);
  const textoCompleto = normalizar(`${comercio} ${bajada} ${descripcion} ${legal}`);
  const { tipo, descuento } = detectarTipoYDescuento(tags, textoCorto);

  const dias = [...new Set([...tags].map((t) => DIAS[t]).filter((d) => d !== undefined))].sort();

  const premium: readonly string[] = BANCOS.santander.tarjetas.premium;
  const desdeTags = [...new Set([...tags].flatMap((t) => TARJETAS[t] ?? []))];
  const desdeTexto = tarjetasDesdeTexto(normalizar(descripcion)) ?? tarjetasDesdeTexto(normalizar(legal));
  const elegidas = desdeTexto ?? desdeTags;
  // El tag `empresas` es confiable aunque el texto no nombre la tarjeta.
  const conEmpresas =
    desdeTags.includes('Empresas') && !elegidas.includes('Empresas') && !elegidas.some((t) => premium.includes(t));
  const tarjetas = conEmpresas ? [...elegidas, 'Empresas'] : elegidas;

  const categorias = [...new Set([...tags].map((t) => CATEGORIAS[t]).filter(Boolean))];

  const sitio = campo(p, 'Sitio web beneficio');

  // Ubicación: "Región cobertura" y "Comuna cobertura" son texto libre y a veces
  // traen lo mismo (ambas con regiones). En ese caso no hay comuna que geocodificar.
  const textoRegion = campo(p, 'Región cobertura');
  const textoComuna = campo(p, 'Comuna cobertura');
  const comunaEsRegion = !!textoComuna && normalizar(textoComuna) === normalizar(textoRegion);

  // Canal: el CMS no lo informa. Se marca online cuando el texto lo dice y
  // presencial cuando hay señal de local (cobertura geográfica o gastronomía).
  // Los servicios para empresas (seguros, asesorías, membresías) no son ninguno
  // de los dos, y marcarlos presencial "por descarte" ensuciaba el filtro.
  const online = /\bonline\b|e-?commerce|tienda virtual|sitio web|\bapp\b|delivery/.test(textoCorto);
  const hayLocal = !!textoComuna || !!textoRegion || tags.has('cat-sabores');
  const presencial = hayLocal || (!online && !tags.has('empresas'));

  const geo = comunaEsRegion
    ? { localidades: [] as Localidad[], regiones: [] as Region[], nacional: false }
    : detectarLocalidades([textoComuna]);

  const regiones = [
    ...new Set<Region>([
      ...geo.regiones,
      ...detectarRegiones([textoRegion, ...(comunaEsRegion ? [textoComuna] : [])]),
      // Tags de región ("metropolitana"); "regiones" a secas no identifica ninguna.
      ...detectarRegiones([...tags].filter((t) => t !== 'regiones')),
    ]),
  ];

  const soloOnline = online && !presencial;
  const localidades = soloOnline ? [] : geo.localidades;

  let alcance: Alcance;
  if (localidades.length) alcance = 'local';
  else if (soloOnline) alcance = 'online';
  else if (regiones.length) alcance = 'regional';
  else if (/todo chile|todas las sucursales|nivel nacional/.test(textoCompleto)) alcance = 'nacional';
  else alcance = 'desconocido';

  const fechaTermino = fechaDesdeTexto(vigencia, 'hasta', ahora);
  const fechaInicio = fechaDesdeTexto(vigencia, 'desde', ahora) ?? p.published_at ?? p.created_at;

  return {
    beneficio: {
      banco: 'santander',
      id: `santander:${p.id}`,
      slug: p.slug || String(p.id),
      titulo: bajada || comercio,
      subtitulo: vigencia,
      descripcion: descripcion || bajada,
      legal,
      link: sitio || p.url || null,
      comercio: { id: String(p.id), nombre: comercio },
      imagen: p.covers?.[1] ?? p.covers?.[0] ?? null,
      logo: p.covers?.[0] ?? null,
      categorias,
      tags: [...tags],
      tipo,
      descuento,
      tope: detectarTope(textoCompleto),
      tarjetas,
      dias,
      presencial,
      online,
      fechaInicio,
      fechaTermino,
      // Se dedujo de "Vigencia" en texto libre: puede no ser exacta.
      ...(fechaTermino ? { fechaTerminoAproximada: true } : {}),
      soloAdultos: false,
      exclusivo: [...tags].some((t) => t.startsWith('exclusivo')) || tarjetas.some((t) => premium.includes(t)),
      // El CMS devuelve las promociones ordenadas por relevancia (updated_at desc).
      prioridad: indice,
      alcance,
      regiones,
    },
    localidades,
  };
}
