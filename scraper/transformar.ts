import type { Alcance, Beneficio, DiaApi, DiaSemana, OfertaApi, TipoBeneficio } from '../shared/beneficio.ts';
import { detectarLocalidades, normalizar, type Localidad } from './localidades.ts';

const DIAS: Record<DiaApi, DiaSemana> = {
  DOMINGO: 0,
  LUNES: 1,
  MARTES: 2,
  MIERCOLES: 3,
  JUEVES: 4,
  VIERNES: 5,
  SABADO: 6,
};

/** Categorías que BCI usa como agrupación de marketing/canal más que como rubro. */
const CATEGORIAS_META = new Set(['Descuentos', 'Presencial', 'Más Beneficios', 'Beneficios del día', 'Actívalo y Úsalo']);

/** Unifica variantes de la misma categoría. */
const ALIAS_CATEGORIA: Record<string, string> = {
  Deporte: 'Deportes',
  Moda: 'Moda y Vestuario',
  Niños: 'Infantil',
};

function limpiar(s: string | undefined | null): string {
  return (s ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function parsearPesos(s: string): number | null {
  const n = Number(s.replace(/\./g, '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function detectarTipoYDescuento(o: OfertaApi, texto: string): { tipo: TipoBeneficio; descuento: number | null } {
  const cashback = o.beneficio.cashback?.porcentajeCashback ?? o.deal.cashback?.percentage;
  if (o.tipoOfertaPrincipal.startsWith('CASHBACK') || cashback) {
    // Viene como fracción (0.07); por si algún día viene como entero, se normaliza.
    const pct = cashback ? (cashback <= 1 ? cashback * 100 : cashback) : null;
    return { tipo: 'cashback', descuento: pct ? Math.round(pct * 10) / 10 : null };
  }

  const pct = o.beneficio.discount?.porcentajeDescuento || o.deal.discount?.percentage || 0;
  if (pct > 0) return { tipo: 'descuento', descuento: pct };

  const titulos = normalizar(`${o.titulo} ${o.subtitulo}`);
  if (/cashback/.test(titulos)) return { tipo: 'cashback', descuento: null };
  if (/cuotas|tasa preferencial/.test(titulos)) return { tipo: 'cuotas', descuento: null };

  // Algunas ofertas tienen el porcentaje solo en el texto ("40 por ciento", "20%").
  const m = texto.match(/(\d{1,2})\s*(?:%|por ?ciento)\s*(?:de )?(?:dcto|descuento)/);
  if (m) return { tipo: 'descuento', descuento: Number(m[1]) };

  return { tipo: 'otro', descuento: null };
}

function detectarTope(texto: string): number | null {
  const m = texto.match(/tope (?:maximo )?(?:de )?(?:\$|clp) ?([\d.,]+)/);
  return m ? parsearPesos(m[1]) : null;
}

/**
 * Tarjetas válidas. Se buscan primero en subtítulo/descripción porque el texto
 * legal menciona sobre todo *exclusiones* (Corporate, MACH, Líder Bci).
 */
function detectarTarjetas(o: OfertaApi): string[] {
  const principal = normalizar(`${o.subtitulo} ${o.descripcion.split('\n')[0]}`);
  const t = /tarjeta|credito|debito/.test(principal) ? principal : normalizar(o.legal);
  const sinExclusiones = t.replace(/se excluyen[^.]*\./g, ' ');

  const tarjetas: string[] = [];
  const agregar = (nombre: string, re: RegExp) => re.test(sinExclusiones) && tarjetas.push(nombre);
  agregar('Crédito', /credito/);
  agregar('Débito', /debito/);
  agregar('Prepago', /prepago/);
  agregar('Visa Infinite', /infinit/);
  agregar('Visa Signature', /signature/);
  agregar('Mastercard Black', /black/);
  agregar('Platinum', /platinum/);
  for (const t of o.deal.total?.tarjetas ?? []) {
    if (t.tipo === 'credito' && !tarjetas.includes('Crédito')) tarjetas.push('Crédito');
    if (t.tipo === 'debito' && !tarjetas.includes('Débito')) tarjetas.push('Débito');
  }
  return tarjetas;
}

export interface BeneficioSinGeo {
  beneficio: Omit<Beneficio, 'ubicaciones'>;
  localidades: Localidad[];
}

export function transformar(o: OfertaApi): BeneficioSinGeo {
  const tags = o.tags.map((t) => t.nombre.trim()).filter(Boolean);
  const categoriasRaw = o.categorias.map((c) => c.titulo.trim());
  const categorias = [
    ...new Set(categoriasRaw.filter((c) => !CATEGORIAS_META.has(c)).map((c) => ALIAS_CATEGORIA[c] ?? c)),
  ];

  const textoCompleto = normalizar(`${o.titulo} ${o.subtitulo} ${o.descripcion} ${o.legal}`);
  const { tipo, descuento } = detectarTipoYDescuento(o, textoCompleto);
  const topeCashback = o.beneficio.cashback?.tope || null;

  const tagsN = tags.map(normalizar);
  const titulosN = normalizar(`${o.titulo} ${o.subtitulo}`);
  const kw = normalizar(o.keywords ?? '');
  const online =
    tagsN.includes('online') ||
    /\bonline\b|en tu app|desde app|sitio web|\.cl\b/.test(titulosN) ||
    /\(canal\): (online|solo por app)/.test(kw) ||
    o.medioDePago?.online === true;
  const presencial =
    tagsN.includes('presencial') ||
    categoriasRaw.includes('Presencial') ||
    categoriasRaw.includes('Restaurantes') ||
    /presencial/.test(titulosN) ||
    /\(canal\): presencial/.test(kw) ||
    o.medioDePago?.presencial === true;

  // Solo textos cortos y "de ubicación": las descripciones mencionan comunas en
  // contextos que no son la ubicación del local.
  const geo = detectarLocalidades([o.comercio.nombre, o.titulo, o.subtitulo, o.keywords ?? '', ...tags]);
  const soloOnline = online && !presencial;
  const localidades = soloOnline ? [] : geo.localidades;

  let alcance: Alcance;
  if (localidades.length) alcance = 'local';
  else if (soloOnline) alcance = 'online';
  else if (geo.nacional) alcance = 'nacional';
  else if (geo.regiones.length) alcance = 'regional';
  else alcance = 'desconocido';

  return {
    beneficio: {
      id: o.id,
      slug: o.slug,
      titulo: limpiar(o.titulo),
      subtitulo: limpiar(o.subtitulo),
      descripcion: limpiar(o.descripcion),
      legal: limpiar(o.legal),
      link: o.link?.trim() || null,
      comercio: { id: o.comercio.id, nombre: limpiar(o.comercio.nombre) },
      imagen: o.imagenes.imagen3 || o.imagenes.imagen1 || null,
      logo: o.imagenes.imagen4 || null,
      categorias,
      tags,
      tipo,
      descuento,
      tope: detectarTope(textoCompleto) ?? topeCashback,
      tarjetas: detectarTarjetas(o),
      dias: [...new Set(o.scheduling.dayRecurrence.map((d) => DIAS[d]).filter((d) => d !== undefined))].sort(),
      presencial,
      online,
      fechaInicio: o.fechaInicio,
      fechaTermino: o.tieneFechaTermino ? o.fechaTermino : null,
      soloAdultos: o.soloAdultos,
      exclusivo: o.isExclusive,
      prioridad: o.prioridad,
      alcance,
      regiones: soloOnline ? [] : geo.regiones,
    },
    localidades,
  };
}
