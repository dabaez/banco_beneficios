import { BANCOS, IDS_BANCOS, esBancoId } from './tipos';
import type { Preferencias } from './preferencias';
import type { BancoId, Beneficio, DiaSemana, TipoBeneficio } from './tipos';

export type Orden = 'descuento' | 'alfabetico' | 'vence' | 'nuevos' | 'cercania' | 'relevancia';

export interface Filtros {
  q: string;
  /** Banco elegido en el encabezado: el sitio muestra un banco a la vez. */
  banco: BancoId;
  categorias: string[];
  comercios: string[];
  tarjetas: string[];
  tipos: TipoBeneficio[];
  descuentoMin: number;
  region: string;
  comunas: string[];
  /** Con región/comuna elegida, incluir también los válidos en todo Chile u online. */
  incluirNacionales: boolean;
  dias: DiaSemana[];
  canal: '' | 'presencial' | 'online';
  soloConMapa: boolean;
  orden: Orden;
}

export const FILTROS_INICIALES: Filtros = {
  q: '',
  banco: IDS_BANCOS[0],
  categorias: [],
  comercios: [],
  tarjetas: [],
  tipos: [],
  descuentoMin: 0,
  region: '',
  comunas: [],
  incluirNacionales: false,
  dias: [],
  canal: '',
  soloConMapa: false,
  orden: 'descuento',
};

/** Tarjetas de un banco, aplanadas, para construir el filtro. */
export function tarjetasDe(banco: BancoId): string[] {
  const { base, premium } = BANCOS[banco].tarjetas;
  return [...base, ...premium];
}

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Índice de búsqueda por beneficio (se calcula una vez). */
export function textoBuscable(b: Beneficio): string {
  return normalizar(
    [
      b.titulo,
      b.subtitulo,
      b.comercio.nombre,
      b.descripcion,
      ...b.categorias,
      ...b.tags,
      ...b.regiones,
      ...b.ubicaciones.flatMap((u) => [u.comuna, u.sector ?? '']),
    ].join(' '),
  );
}

export function estaVigente(b: Beneficio, ahora: Date): boolean {
  return !b.fechaTermino || new Date(b.fechaTermino) >= ahora;
}

/**
 * "Mis tarjetas": el usuario marca las que tiene.
 * - Si la oferta exige un nivel premium (Infinite, Black, American Express…),
 *   el usuario debe tener alguno de ellos.
 * - Si la oferta indica crédito/débito, debe tener alguno de esos
 *   (tener una premium implica tener crédito).
 * Se evalúa contra las tarjetas del banco de la oferta.
 */
function cumpleTarjetas(b: Beneficio, seleccion: string[]): boolean {
  if (!seleccion.length) return true;
  const { base, premium } = BANCOS[b.banco].tarjetas;

  const premiumUsuario = seleccion.filter((t) => (premium as readonly string[]).includes(t));
  const baseUsuario = new Set(seleccion.filter((t) => (base as readonly string[]).includes(t)));
  if (premiumUsuario.length) baseUsuario.add('Crédito');

  const premiumOferta = b.tarjetas.filter((t) => (premium as readonly string[]).includes(t));
  const baseOferta = b.tarjetas.filter((t) => (base as readonly string[]).includes(t));

  if (premiumOferta.length && !premiumOferta.some((t) => premiumUsuario.includes(t))) return false;
  if (baseOferta.length && !baseOferta.some((t) => baseUsuario.has(t))) return false;
  return true;
}

function cumpleUbicacion(b: Beneficio, f: Filtros): boolean {
  if (!f.region && !f.comunas.length) return true;
  const general = b.alcance === 'nacional' || b.alcance === 'online';
  if (general) return f.incluirNacionales;
  if (f.comunas.length) return b.ubicaciones.some((u) => f.comunas.includes(u.comuna));
  return b.regiones.includes(f.region);
}

export function aplicarFiltros(
  lista: { b: Beneficio; texto: string }[],
  f: Filtros,
  ahora: Date,
): Beneficio[] {
  const terminos = normalizar(f.q).split(/\s+/).filter(Boolean);
  return lista
    .filter(({ b, texto }) => {
      if (!estaVigente(b, ahora)) return false;
      if (b.banco !== f.banco) return false;
      if (terminos.length && !terminos.every((t) => texto.includes(t))) return false;
      if (f.categorias.length && !b.categorias.some((c) => f.categorias.includes(c))) return false;
      if (f.comercios.length && !f.comercios.includes(b.comercio.nombre)) return false;
      if (f.tipos.length && !f.tipos.includes(b.tipo)) return false;
      if (f.descuentoMin > 0 && (b.descuento ?? 0) < f.descuentoMin) return false;
      if (!cumpleTarjetas(b, f.tarjetas)) return false;
      if (!cumpleUbicacion(b, f)) return false;
      if (f.dias.length && b.dias.length && !b.dias.some((d) => f.dias.includes(d))) return false;
      if (f.canal === 'presencial' && !b.presencial) return false;
      if (f.canal === 'online' && !b.online) return false;
      if (f.soloConMapa && !b.ubicaciones.length) return false;
      return true;
    })
    .map(({ b }) => b);
}

function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function distanciaMinima(b: Beneficio, punto: { lat: number; lng: number }): number {
  return b.ubicaciones.reduce((min, u) => Math.min(min, distanciaKm(u, punto)), Infinity);
}

const colator = new Intl.Collator('es', { sensitivity: 'base' });

export function ordenar(lista: Beneficio[], orden: Orden, punto: { lat: number; lng: number } | null): Beneficio[] {
  const alfa = (a: Beneficio, b: Beneficio) => colator.compare(a.comercio.nombre, b.comercio.nombre);
  const copia = [...lista];
  switch (orden) {
    case 'descuento':
      return copia.sort((a, b) => (b.descuento ?? -1) - (a.descuento ?? -1) || alfa(a, b));
    case 'alfabetico':
      return copia.sort((a, b) => alfa(a, b) || colator.compare(a.titulo, b.titulo));
    case 'vence':
      return copia.sort(
        (a, b) =>
          (a.fechaTermino ? Date.parse(a.fechaTermino) : Infinity) -
            (b.fechaTermino ? Date.parse(b.fechaTermino) : Infinity) || alfa(a, b),
      );
    case 'nuevos':
      return copia.sort((a, b) => Date.parse(b.fechaInicio) - Date.parse(a.fechaInicio) || alfa(a, b));
    case 'cercania':
      if (!punto) return copia;
      return copia.sort((a, b) => distanciaMinima(a, punto) - distanciaMinima(b, punto) || alfa(a, b));
    case 'relevancia':
      return copia.sort((a, b) => a.prioridad - b.prioridad || (b.descuento ?? -1) - (a.descuento ?? -1));
  }
}

/** Filtros en blanco, conservando lo que no es un filtro (banco y orden). */
export function filtrosLimpios(f: Filtros): Filtros {
  return { ...FILTROS_INICIALES, banco: f.banco, orden: f.orden };
}

export function contarFiltrosActivos(f: Filtros): number {
  return (
    (f.q ? 1 : 0) +
    f.categorias.length +
    f.comercios.length +
    f.tarjetas.length +
    f.tipos.length +
    (f.descuentoMin ? 1 : 0) +
    (f.region ? 1 : 0) +
    f.comunas.length +
    f.dias.length +
    (f.canal ? 1 : 0) +
    (f.soloConMapa ? 1 : 0)
  );
}

// ---------------------------------------------------------------------------
// Sincronización con la URL (para compartir una búsqueda)
// ---------------------------------------------------------------------------

const LISTAS = ['categorias', 'comercios', 'tarjetas', 'tipos', 'comunas'] as const;

export function filtrosAUrl(f: Filtros): string {
  const p = new URLSearchParams();
  // Siempre en la URL: un enlace compartido abre el banco de quien lo compartió.
  p.set('banco', f.banco);
  if (f.q) p.set('q', f.q);
  for (const k of LISTAS) if (f[k].length) p.set(k, f[k].join('|'));
  if (f.descuentoMin) p.set('min', String(f.descuentoMin));
  if (f.region) p.set('region', f.region);
  if (f.incluirNacionales) p.set('nacionales', '1');
  if (f.dias.length) p.set('dias', f.dias.join(''));
  if (f.canal) p.set('canal', f.canal);
  if (f.soloConMapa) p.set('mapa', '1');
  if (f.orden !== FILTROS_INICIALES.orden && f.orden !== 'cercania') p.set('orden', f.orden);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Lee los filtros de la URL. Lo que la URL no trae se completa con las
 * preferencias guardadas: banco, tarjetas de ese banco y filtros de ubicación.
 * Así un enlace compartido manda, pero abrir el sitio "limpio" recupera lo último.
 */
export function filtrosDesdeUrl(search: string, prefs?: Preferencias): Filtros {
  const p = new URLSearchParams(search);
  const f: Filtros = { ...FILTROS_INICIALES };
  const banco = p.get('banco');
  if (banco && esBancoId(banco)) f.banco = banco;
  else if (prefs?.banco) f.banco = prefs.banco;
  f.q = p.get('q') ?? '';
  for (const k of LISTAS) {
    const v = p.get(k);
    // @ts-expect-error: los tipos de cada lista se validan al filtrar
    if (v) f[k] = v.split('|').filter(Boolean);
  }
  f.descuentoMin = Number(p.get('min')) || 0;
  f.region = p.get('region') ?? '';
  f.incluirNacionales = p.get('nacionales') === '1';
  f.dias = [...(p.get('dias') ?? '')].map(Number).filter((d) => d >= 0 && d <= 6) as DiaSemana[];
  const canal = p.get('canal');
  f.canal = canal === 'presencial' || canal === 'online' ? canal : '';
  f.soloConMapa = p.get('mapa') === '1';
  const orden = p.get('orden') as Orden | null;
  if (orden && ['descuento', 'alfabetico', 'vence', 'nuevos', 'relevancia'].includes(orden)) f.orden = orden;

  if (!p.has('tarjetas')) f.tarjetas = prefs?.tarjetas[f.banco] ?? [];
  // Solo tarjetas que existen en ese banco (lo guardado puede ser de otra versión).
  const validas = tarjetasDe(f.banco);
  f.tarjetas = f.tarjetas.filter((t) => validas.includes(t));

  // La ubicación se trata como un bloque: si la URL trae alguna parte, manda la URL.
  const urlTraeUbicacion = ['region', 'comunas', 'nacionales', 'mapa'].some((k) => p.has(k));
  if (!urlTraeUbicacion && prefs?.ubicacion) Object.assign(f, prefs.ubicacion);
  return f;
}
