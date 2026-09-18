/**
 * Normalización de los beneficios de BancoEstado.
 *
 * Todo sale de HTML (ver tipos.ts), así que lo estructurado es poco: los
 * `data-subfiltros` de cada tarjeta (días, zona, modalidad y a veces tarjeta) y
 * las secciones rotuladas de la ficha. El porcentaje, la vigencia, el tope y
 * las tarjetas válidas se sacan del texto.
 *
 * Además un mismo beneficio puede aparecer en más de un listado (Carnes Premium
 * está en Bieeneficios y en Sabores) y una misma ficha puede tener varias
 * ofertas (Rappi: $5.000 de dto., 50% en la primera compra, 3 meses PRO). Por
 * eso `deduplicar` corre antes de `transformar`.
 */
import type { Alcance, DiaSemana, TipoBeneficio } from '../../../shared/beneficio.ts';
import { detectarLocalidades, normalizar, type Localidad, type Region } from '../../localidades.ts';
import type { BeneficioSinGeo } from '../../tipos.ts';
import { LISTADOS } from './api.ts';
import type { PaginaListado, TarjetaCruda } from './tipos.ts';

/** Tarjeta ya deduplicada: `paginas` son todos los listados donde apareció. */
export interface TarjetaUnida extends TarjetaCruda {
  paginas: PaginaListado[];
}

const DIAS: Record<string, DiaSemana> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Zonas de los subfiltros ("V Región") → región. La XIII es "Región Metropolitana". */
const ZONAS: Record<string, Region> = {
  'xv region': 'Arica y Parinacota',
  'i region': 'Tarapacá',
  'ii region': 'Antofagasta',
  'iii region': 'Atacama',
  'iv region': 'Coquimbo',
  'v region': 'Valparaíso',
  'region metropolitana': 'Metropolitana',
  'vi region': "O'Higgins",
  'vii region': 'Maule',
  'xvi region': 'Ñuble',
  'viii region': 'Biobío',
  'ix region': 'La Araucanía',
  'xiv region': 'Los Ríos',
  'x region': 'Los Lagos',
  'xi region': 'Aysén',
  'xii region': 'Magallanes',
};

/** Pestañas de "todos-beneficios" (`data-category`) → categoría para mostrar. */
const CATEGORIAS_TODOS: Record<string, string> = {
  viajes: 'Viajes',
  bienestar: 'Bienestar',
  hogar: 'Hogar y mascotas',
  impacto: 'Impacto verde',
  vestuario: 'Vestuario',
  cuotas: 'Cuotas sin interés',
  otros: 'Otros servicios',
};

/** Subfiltro "tipo" de Bieeneficios → las mismas categorías de los otros listados. */
const CATEGORIAS_TIPO: Record<string, string> = {
  'retail y vestuario': 'Vestuario',
  'experiencias y entretencion': 'Entretención',
  'salud y belleza': 'Bienestar',
  hogar: 'Hogar y mascotas',
  'comida rapida': 'Restaurantes',
  panaderia: 'Restaurantes',
  delivery: 'Restaurantes',
  'bebestibles y liquidos': 'Restaurantes',
  supermercado: 'Supermercado',
  combustible: 'Combustible',
};

const CATEGORIA_PAGINA: Record<PaginaListado, string | null> = {
  todos: null,
  bieneficios: 'Bieeneficios',
  sabores: 'Restaurantes',
  panoramas: 'Entretención',
};

/** Tarjetas con que aplica "todas las tarjetas" (Rutpay solo si se nombra). */
const TODAS = ['Crédito', 'Débito', 'CuentaRUT'];

function limpiar(s: string | null | undefined): string {
  return (s ?? '').replace(/[\s\u200b]+/g, ' ').trim();
}

/** Une textos de la tarjeta: "25% de descuento" + "en estacionamientos." → una frase. */
function unir(partes: string[]): string {
  let r = '';
  for (const p of partes.map(limpiar).filter(Boolean)) {
    if (!r) r = p;
    else if (normalizar(r).includes(normalizar(p))) continue;
    else r += /^[a-zà-ú$+(]/.test(p) ? ` ${p}` : ` · ${p}`;
  }
  return r;
}

// ——— Fechas ————————————————————————————————————————————————————————————————

/**
 * Meses con erratas ("novimbre", "setiembre"): se comparan por prefijo, con un
 * largo parecido para que "mayores" no sea mayo.
 */
function indiceMes(nombre: string): number {
  if (/^setiembre$/.test(nombre)) return 8;
  return MESES.findIndex((m) => m.slice(0, 4) === nombre.slice(0, 4) && Math.abs(m.length - nombre.length) <= 1);
}

interface FechaTexto {
  dia: number;
  mes: number;
  anio: number | null;
}

/**
 * Fechas de un texto libre, en orden. Formatos observados:
 *   "Desde el 1 de septiembre al 31 de diciembre 2026."
 *   "Vigencia 01 de enero al 31 diciembre del 2026."
 *   "Del 1 al 30 de septiembre de 2026."   (el mes va solo al final)
 *   "desde el 01/09/2026 hasta 20/09/2026"
 *   "contratadas entre 01.09.2025 hasta el 31.12.2026"
 */
function fechasEnTexto(texto: string): FechaTexto[] {
  let t = normalizar(texto)
    .replace(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/g, (_, d, m, a) => `${d} de ${MESES[Number(m) - 1] ?? 'x'} de ${a}`)
    // "del 1 al 30 de septiembre" → "del 1 de septiembre al 30 de septiembre"
    .replace(/\b(\d{1,2})\s+(al|hasta(?: el)?|y)\s+(\d{1,2})\s+de\s+([a-z]+)/g, '$1 de $4 $2 $3 de $4');
  t = t.replace(/\s+/g, ' ');

  const fechas: FechaTexto[] = [];
  for (const m of t.matchAll(/\b(\d{1,2})(?:\s+de)?\s+([a-z]+)(?:,?\s+(?:de|del)?\s*(20\d{2}))?/g)) {
    const mes = indiceMes(m[2]);
    const dia = Number(m[1]);
    if (mes < 0 || dia < 1 || dia > 31) continue;
    fechas.push({ dia, mes, anio: m[3] ? Number(m[3]) : null });
  }
  return fechas;
}

/**
 * Vigencia de un texto: la fecha más tardía es el término y la más temprana,
 * si hay más de una, el inicio. No siempre van en orden: "todos los viernes,
 * desde el 1 al 30 de septiembre, además del jueves 17 de septiembre".
 *
 * A una fecha sin año se le pone el de la siguiente que lo tenga ("desde el 1
 * de agosto al 31 de diciembre 2026"), o el anterior si así quedaría después
 * de ella ("del 1 de octubre al 31 de marzo 2027"); si ninguna lo tiene, el
 * año en curso.
 */
function vigenciaDeTexto(texto: string, ahora: Date): { inicio: string | null; termino: string | null } {
  const fechas = fechasEnTexto(texto);
  const resueltas: number[] = [];
  for (const [i, f] of fechas.entries()) {
    const ref = fechas.slice(i + 1).find((x) => x.anio != null);
    let anio = f.anio ?? ref?.anio ?? fechas.find((x) => x.anio != null)?.anio ?? ahora.getUTCFullYear();
    if (f.anio == null && ref && (f.mes > ref.mes || (f.mes === ref.mes && f.dia > ref.dia))) anio--;
    const ms = Date.UTC(anio, f.mes, f.dia);
    if (new Date(ms).getUTCMonth() === f.mes) resueltas.push(ms); // descarta "31 de septiembre"
  }
  if (!resueltas.length) return { inicio: null, termino: null };

  const dia = 24 * 3600 * 1000;
  const termino = new Date(Math.max(...resueltas) + dia - 1000).toISOString(); // 23:59:59 UTC
  const inicio = resueltas.length > 1 ? new Date(Math.min(...resueltas)).toISOString() : null;
  return { inicio, termino };
}

/**
 * Entre varios textos candidatos, el primero que tenga término. Si ninguno de
 * los preferidos lo tiene, entre los demás gana el término más lejano (hay
 * fichas que conservan la vigencia del año anterior junto a la actual).
 */
function vigencia(preferidos: string[], otros: string[], ahora: Date) {
  for (const t of preferidos) {
    const v = vigenciaDeTexto(t, ahora);
    if (v.termino) return v;
  }
  let mejor: { inicio: string | null; termino: string | null } = { inicio: null, termino: null };
  for (const t of otros) {
    const v = vigenciaDeTexto(t, ahora);
    if (v.termino && (!mejor.termino || v.termino > mejor.termino)) mejor = v;
  }
  return mejor;
}

// ——— Días ——————————————————————————————————————————————————————————————————

const RE_DIA = 'lunes|martes|miercoles|jueves|viernes|sabados?|domingos?';

/** "Sábados" y "domingos" vienen también en plural. */
function dia(nombre: string): DiaSemana | undefined {
  return DIAS[nombre] ?? DIAS[nombre.replace(/s$/, '')];
}

/** Días del subfiltro "dia". Incluir "Todos los días" significa sin restricción. */
function diasDeSubfiltro(valores: string[] | undefined): DiaSemana[] | null {
  if (!valores?.length) return null;
  const vs = valores.map(normalizar);
  if (vs.some((v) => v.startsWith('todos'))) return [];
  const dias = vs.map(dia).filter((d) => d !== undefined);
  return dias.length ? dias : null;
}

/** "todos los martes y jueves", "los días domingo", "de lunes a viernes". */
function diasDeTexto(texto: string): DiaSemana[] {
  const t = normalizar(texto);
  const rango = t.match(new RegExp(`\\bde (${RE_DIA}) a (${RE_DIA})\\b`));
  if (rango) {
    const a = dia(rango[1])!;
    const b = dia(rango[2])!;
    const r: DiaSemana[] = [];
    for (let d = a; ; d = ((d + 1) % 7) as DiaSemana) {
      r.push(d);
      if (d === b || r.length > 7) break;
    }
    return r;
  }
  const m = t.match(new RegExp(`\\b(?:todos los|los dias|cada|exclusivamente los dias)\\s+((?:(?:${RE_DIA})(?:\\s*(?:,|y)\\s*)?)+)`));
  if (!m) return [];
  return [...new Set([...m[1].matchAll(new RegExp(RE_DIA, 'g'))].map((x) => dia(x[0])!))];
}

// ——— Tarjetas ——————————————————————————————————————————————————————————————

/**
 * Tarjetas según un texto de medios de pago. `null` si no nombra ninguna
 * ("Tarjetas BancoEstado" a secas: vale cualquiera).
 *
 * "Cuenta Corriente Digital" se trata como débito (es su tarjeta), marcando el
 * beneficio como exclusivo en quien llama.
 */
function tarjetasDeTexto(texto: string): string[] | null {
  const t = normalizar(texto);
  if (!t) return null;
  const visa = /\bvisa\b/.test(t);
  const master = /master ?card|mastecard/.test(t);
  const marca = visa !== master ? [visa ? 'Visa' : 'Mastercard'] : [];

  const base = new Set<string>();
  if (/credito/.test(t)) base.add('Crédito');
  if (/debito|cuenta corriente digital/.test(t)) base.add('Débito');
  if (/cuenta ?rut/.test(t)) base.add('CuentaRUT');
  if (/rutpay/.test(t)) base.add('Rutpay');
  if (/todas las tarjetas/.test(t)) TODAS.forEach((x) => base.add(x));

  if (marca.length) return ['Crédito', ...marca]; // las Visa/Mastercard de BancoEstado son de crédito
  return base.size ? [...base] : null;
}

/** "No aplica para compras con Tarjetas de Débito ni CuentaRUT." → quita esas. */
function sinExcluidas(tarjetas: string[], textos: string[]): string[] {
  const excluidas = new Set<string>();
  for (const texto of textos) {
    for (const m of normalizar(texto).matchAll(/no (?:aplica|es valid[oa]|incluye)[^.]*/g)) {
      if (/debito/.test(m[0])) excluidas.add('Débito');
      if (/cuenta ?rut/.test(m[0])) excluidas.add('CuentaRUT');
      if (/rutpay/.test(m[0])) excluidas.add('Rutpay');
    }
  }
  const r = tarjetas.filter((x) => !excluidas.has(x));
  return r.length ? r : tarjetas;
}

// ——— Oferta ————————————————————————————————————————————————————————————————

/**
 * Porcentaje de la oferta. Bieeneficios muestra dos ("50% dto. con Rutpay" y
 * "40% dto. Tarjetas BancoEstado"): se usa el de tarjetas, que es el que sirve
 * a cualquier cliente, y si no hay, el mayor.
 */
function porcentaje(partes: string[]): number | null {
  const candidatos = partes.flatMap((p) =>
    [...normalizar(p).matchAll(/(\d{1,3})\s*%/g)]
      .map((m) => ({ pct: Number(m[1]), rutpay: /rutpay/.test(normalizar(p)) }))
      .filter((c) => c.pct > 0 && c.pct <= 100),
  );
  if (!candidatos.length) return null;
  const conTarjeta = candidatos.filter((c) => !c.rutpay);
  return Math.max(...(conTarjeta.length ? conTarjeta : candidatos).map((c) => c.pct));
}

function tipoYDescuento(oferta: string): { tipo: TipoBeneficio; descuento: number | null } {
  const t = normalizar(oferta);
  const pct = porcentaje([oferta]);
  if (/cuotas sin interes/.test(t) && pct == null) return { tipo: 'cuotas', descuento: null };
  if (/cashback|devolucion/.test(t)) return { tipo: 'cashback', descuento: pct };
  if (pct != null) return { tipo: 'descuento', descuento: pct };
  if (/\$\s?[\d.]+ (?:de )?(?:dto|descuento)|dto\.|descuento/.test(t)) return { tipo: 'descuento', descuento: null };
  return { tipo: 'otro', descuento: null };
}

function detectarTope(texto: string): number | null {
  const m = normalizar(texto).match(/tope(?: maximo)?(?: de descuento)?(?: por (?:transaccion|compra|boleta))?(?: de)? \$ ?([\d.]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ——— Deduplicación —————————————————————————————————————————————————————————

/**
 * Identidad de una oferta: su ficha (o su tarjeta) más lo que ofrece. Si la
 * tarjeta no trae ninguna cifra, cada listado la redacta distinto ("Más
 * Diversión"): basta la ficha.
 */
function claveOferta(t: TarjetaCruda): string {
  const oferta = [t.titulo, t.subtitulo, t.descripcion].join(' ');
  const lugar = t.link ?? `${t.pagina}/${t.id}`;
  if (t.link && !/\d/.test(oferta)) return lugar;
  // Sin porcentaje, el monto ("Hasta $7.000 de dto." / "Dto. en Cilindros hasta $7.000").
  const monto = oferta.match(/\$\s?[\d.]+/)?.[0].replace(/\s/g, '');
  return `${lugar}|${porcentaje([oferta]) ?? monto ?? normalizar(oferta)}`;
}

/**
 * Junta tarjetas repetidas: la misma oferta en dos listados (se conserva la
 * primera y se suman las categorías) o dos veces en el mismo listado. Los
 * eventos terminados o agotados se descartan aquí.
 */
export function deduplicar(tarjetas: TarjetaCruda[]): TarjetaUnida[] {
  const porClave = new Map<string, TarjetaUnida>();
  for (const t of tarjetas) {
    if (t.variante === 'evento' && !t.subfiltros.opciones?.includes('Evento Activo')) continue;
    const clave = claveOferta(t);
    const previa = porClave.get(clave);
    if (!previa) {
      porClave.set(clave, { ...t, paginas: [t.pagina] });
      continue;
    }
    previa.categorias = [...new Set([...previa.categorias, ...t.categorias])];
    previa.paginas = [...new Set([...previa.paginas, t.pagina])];
  }
  return [...porClave.values()];
}

// ——— Transformación ————————————————————————————————————————————————————————

function slug(s: string): string {
  return normalizar(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Nombres genéricos que el CMS usa como `data-name` ("Cuotas sin interes", "3 o 6 mascotas"). */
function nombreComercio(t: TarjetaCruda): string {
  const generico = /cuotas|^\d|^mas diversion$/.test(normalizar(t.nombre));
  const titulo = t.detalle?.titulo;
  if (generico && titulo && !/cuotas sin interes/.test(normalizar(titulo))) return titulo;
  // Algunos nombres traen el producto: "Solar Fotovoltaica Cuotas Sin Interes".
  return limpiar(t.nombre.replace(/\s+cuotas sin inter[eé]s$/i, '')) || titulo || t.id;
}

function categorias(t: TarjetaUnida): string[] {
  const r = new Set<string>();
  for (const p of t.paginas) {
    const c = CATEGORIA_PAGINA[p];
    if (c) r.add(c);
  }
  for (const c of t.categorias) if (CATEGORIAS_TODOS[c]) r.add(CATEGORIAS_TODOS[c]);
  if (t.paginas.includes('bieneficios')) {
    for (const tipo of t.subfiltros.tipo ?? []) {
      const c = CATEGORIAS_TIPO[normalizar(tipo)];
      if (c) r.add(c);
    }
  }
  return [...r];
}

function regionesDeZonas(zonas: string[] | undefined): Region[] {
  return [...new Set((zonas ?? []).map((z) => ZONAS[normalizar(z)]).filter(Boolean))];
}

/** Dirección de un local tal como la entrega el sitio, sin el punto final ni "local 5". */
function limpiarDireccion(s: string): string {
  return limpiar(s)
    .replace(/[.;]+$/, '')
    .replace(/,?\s*\b(?:local|loc\.?|l)\s*\d+[a-z]?\b/gi, '')
    .trim();
}

/** Comuna de cada dirección de "Locales disponibles" (Sabores). */
function localidadesDeLocales(locales: string[]): Localidad[] {
  const r: Localidad[] = [];
  for (const local of locales) {
    // La comuna va al final: "Av. Central 184, Reñaca." / "Manuel Montt 697, Providencia."
    const partes = local.split(',');
    const { localidades } = detectarLocalidades([partes[partes.length - 1] ?? '', local]);
    const l = localidades[0];
    if (l) r.push({ ...l, direccion: limpiarDireccion(partes.length > 1 ? partes.slice(0, -1).join(',') : local) });
  }
  return r;
}

export function transformar(t: TarjetaUnida, indice: number, ahora = new Date()): BeneficioSinGeo | null {
  const nombre = nombreComercio(t);
  if (!nombre) return null;

  const d = t.detalle;
  const secciones = d?.secciones ?? {};
  const seccion = (...ks: string[]) => ks.map((k) => secciones[k]).find(Boolean) ?? '';
  const detalleSeccion = seccion('Detalle');
  const donde = seccion('Dónde');
  const medios = seccion('Medios de Pago', 'Medio de Pago', 'Medios de pago');
  const vigenciaSeccion = seccion('Vigencia');
  const esEvento = t.variante === 'evento' && !!t.evento;
  const esSabores = t.variante === 'sabores';
  const modalTextos = t.modal?.textos ?? [];

  // Texto de la oferta según la variante de tarjeta.
  let titulo: string;
  let oferta: string;
  if (esSabores) {
    // Sabores: título = día ("Todos los días"), subtítulo = "50% dto.".
    oferta = t.subtitulo || t.titulo;
    titulo = unir([t.subtitulo, t.titulo]);
  } else if (t.variante === 'evento') {
    oferta = t.subtitulo;
    titulo = esEvento ? unir([t.subtitulo, 'en entradas']) : unir([t.subtitulo, t.descripcion]);
  } else {
    oferta = unir([t.titulo, t.subtitulo, t.descripcion]);
    titulo = oferta;
  }
  // Si la tarjeta no trae ninguna cifra ("Más Diversión"), el porcentaje se busca en la
  // ficha. Con cifras no: "Pack Preventivo $19.990" no es el "80%" de otra prestación.
  const pctOferta = porcentaje([oferta]);
  const respaldo = /\d/.test(oferta) ? '' : detalleSeccion || d?.legal || '';
  const { tipo, descuento } = tipoYDescuento(`${oferta} ${respaldo}`);

  // Textos libres de la ficha que no son la bajada legal (plantilla sin secciones).
  const textosFicha = (d?.textos ?? []).filter((x) => x !== d?.legal && x.length < 400);
  const legal = limpiar(d?.legal || (t.variante === 'evento' ? modalTextos.join(' ') : ''));

  // Vigencia: sección "Vigencia", modal de Sabores, fecha del evento o texto libre.
  const candidatosVigencia = [vigenciaSeccion, ...(esSabores ? modalTextos : [])].filter(Boolean);
  const otrosVigencia = [...textosFicha.filter((x) => /vigencia|valid[oa]|desde|hasta/.test(normalizar(x))), legal];
  let { inicio, termino } = esEvento
    ? { inicio: null, termino: vigenciaDeTexto(t.evento!.fecha, ahora).termino }
    : vigencia(candidatosVigencia, otrosVigencia, ahora);
  // Bieeneficios pone el rango en el pretítulo ("Del 1 al 30 de septiembre").
  if (!termino && t.pagina === 'bieneficios') ({ inicio, termino } = vigenciaDeTexto(t.pretitulo, ahora));

  // Tarjetas: medios de pago de la ficha → modal → texto libre → subfiltros → pretítulo.
  const subTarjeta = [...(t.subfiltros.tarjeta ?? []), ...(t.subfiltros.medio ?? [])];
  const textoTarjetas =
    medios ||
    (esSabores ? modalTextos[0] : '') ||
    textosFicha.filter((x) => /tarjeta/i.test(x)).join(' ') ||
    (esEvento ? legal : '');
  let tarjetas =
    tarjetasDeTexto(textoTarjetas) ?? tarjetasDeTexto(subTarjeta.join(' ')) ?? tarjetasDeTexto(t.pretitulo) ?? [];
  // CuentaRUT: el texto suele omitirla y el subfiltro la marca aparte.
  if (!/cuenta ?rut/.test(normalizar(textoTarjetas)) && subTarjeta.includes('Tarjeta CuentaRUT') && tarjetas.includes('Débito')) {
    tarjetas.push('CuentaRUT');
  }
  tarjetas = sinExcluidas(tarjetas, [...textosFicha, legal, medios]);
  // Las cuotas sin interés son solo con crédito.
  if (tipo === 'cuotas') tarjetas = tarjetas.filter((x) => x === 'Crédito' || x === 'Visa' || x === 'Mastercard');
  if (tipo === 'cuotas' && !tarjetas.includes('Crédito')) tarjetas.unshift('Crédito');
  tarjetas = [...new Set(tarjetas)];

  const exclusivo =
    tarjetas.includes('Visa') ||
    tarjetas.includes('Mastercard') ||
    subTarjeta.some((s) => /exclusiv|solo/i.test(s)) ||
    /exclusiv/.test(normalizar(`${t.pretitulo} ${medios}`)) ||
    /black|platinum|cuenta corriente digital/.test(normalizar(`${t.pretitulo} ${medios} ${subTarjeta.join(' ')}`));

  // Días: el texto explícito ("todos los miércoles") manda, porque hay subfiltros
  // que marcan todos los días (McDonald's); si no, el subfiltro.
  // El detalle de la ficha no: suele mezclar canales ("en web, todos los miércoles").
  const diasTexto = diasDeTexto([t.titulo, t.subtitulo, t.descripcion, vigenciaSeccion].join('. '));
  let dias = diasTexto.length ? diasTexto : (diasDeSubfiltro(t.subfiltros.dia) ?? []);
  if (new Set(dias).size === 7) dias = [];

  // Canal: subfiltro "modalidad" si existe; si no, del texto.
  const textoCanal = normalizar([t.descripcion, donde, detalleSeccion, textosFicha.slice(0, 12).join(' ')].join(' '));
  const modalidad = (t.subfiltros.modalidad ?? []).map(normalizar);
  let online: boolean;
  let presencial: boolean;
  if (esEvento) {
    // La entrada se compra online (PuntoTicket); el pin sería el recinto, no un comercio.
    online = true;
    presencial = false;
  } else if (modalidad.length) {
    online = modalidad.includes('online');
    presencial = modalidad.includes('presencial');
  } else {
    online = /\bonline\b|www\.|\.cl\b|\.com\b|\bapp\b|sitio web|e-?commerce|link de pago/.test(textoCanal);
    presencial = /presencial|tienda|local|caja|sucursal|estacion|clinica|recepcion/.test(textoCanal) || !online;
  }

  // Ubicación: direcciones del modal de Sabores; si no, la sección "Dónde".
  const regionesZona = regionesDeZonas(t.subfiltros.zona);
  let localidades: Localidad[] = [];
  let nacional = false;
  if (esSabores) {
    localidades = localidadesDeLocales(t.modal?.locales ?? []);
  } else if (donde && presencial) {
    const geo = detectarLocalidades([donde]);
    localidades = geo.localidades;
    nacional = geo.nacional;
  }
  if (!presencial) localidades = [];
  const regiones = [...new Set<Region>([...regionesZona, ...localidades.map((l) => l.region)])];

  let alcance: Alcance;
  if (localidades.length) alcance = 'local';
  else if (online && !presencial) alcance = 'online';
  else if (nacional || /todo chile|a nivel nacional|todas las tiendas|todos los locales/.test(textoCanal)) alcance = 'nacional';
  else if (regiones.length) alcance = 'regional';
  else alcance = 'desconocido';

  // Descripción: lo que la ficha explica (secciones o texto libre), o el modal.
  let descripcion: string;
  if (Object.keys(secciones).length) {
    descripcion = [detalleSeccion, donde && `Dónde: ${donde}`, medios && `Medios de pago: ${medios}`].filter(Boolean).join('\n\n');
  } else if (textosFicha.length) {
    descripcion = textosFicha.slice(0, 15).join('\n');
  } else if (esSabores) {
    const locales = t.modal?.locales ?? [];
    descripcion = [...modalTextos, locales.length ? `Locales: ${locales.join(' · ')}` : ''].filter(Boolean).join('\n\n');
  } else if (esEvento) {
    descripcion = `${t.evento!.lugar} · ${t.evento!.fecha}`;
  } else {
    descripcion = titulo;
  }

  const subtitulo = esEvento
    ? `${t.evento!.lugar} · ${t.evento!.fecha}`
    : vigenciaSeccion || (esSabores ? modalTextos[1] ?? '' : '') || (t.pagina === 'bieneficios' ? t.pretitulo : '');

  // Link: la ficha del banco (tiene las condiciones), si no el del comercio.
  const link = d?.url ?? t.modal?.link ?? t.link ?? LISTADOS[t.pagina];

  const slugBase = d ? slug(d.url.split('/').pop()!.replace(/---.*$|\.html$/, '')) : slug(`${t.pagina}-${t.id}`);
  // Una ficha puede tener varias ofertas (Rappi): el id lleva también la oferta.
  const id = `bancoestado:${slugBase}-${pctOferta ?? slug(oferta).slice(0, 40)}`;

  const tags = [
    ...t.paginas.map((p) => `listado:${p}`),
    ...(t.subfiltros.tipo ?? []).filter((x) => x !== 'Todos'),
    ...(t.subfiltros.mall ?? []),
    ...subTarjeta,
  ].map((x) => normalizar(x));

  return {
    beneficio: {
      banco: 'bancoestado',
      id,
      slug: slugBase,
      titulo: titulo || nombre,
      subtitulo: limpiar(subtitulo),
      descripcion: descripcion || titulo,
      legal,
      link,
      comercio: { id: slug(t.id || nombre), nombre },
      imagen: t.imagen,
      logo: t.imagen,
      categorias: categorias(t),
      tags: [...new Set(tags)],
      tipo,
      descuento,
      // El tope solo tiene sentido para un porcentaje ("$5.000 de dto." ya es el monto).
      tope: descuento != null ? detectarTope([oferta, medios, modalTextos.join(' '), detalleSeccion, legal].join(' ')) : null,
      tarjetas,
      dias: [...new Set(dias)].sort(),
      presencial,
      online,
      fechaInicio: inicio ?? d?.modificado ?? new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)).toISOString(),
      fechaTermino: termino,
      // Deducida de texto libre: puede no ser exacta.
      ...(termino ? { fechaTerminoAproximada: true } : {}),
      soloAdultos: false,
      exclusivo,
      // Orden del sitio: primero "todos", luego Bieeneficios, Sabores y eventos.
      prioridad: indice,
      alcance,
      regiones,
    },
    localidades,
  };
}
