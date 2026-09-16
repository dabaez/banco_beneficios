/**
 * Tipos compartidos entre el scraper y el frontend.
 *
 * `OfertaApi` refleja la respuesta real de
 * GET https://api.bciplus.cl/bff-loyalty-beneficios/v1/offers (inspeccionada el 2026-09-15).
 * `Beneficio` es la forma normalizada/enriquecida que se guarda en data/beneficios.json.
 *
 * Solo sintaxis "borrable" (interfaces/types, sin enums) para que Node pueda
 * ejecutar el scraper con type stripping nativo.
 */

// ---------------------------------------------------------------------------
// Respuesta cruda de la API
// ---------------------------------------------------------------------------

export interface RespuestaOfertasApi {
  paginado: {
    cantidadTotal: number;
    itemsPorPagina: number;
    paginaActual: number;
    totalPaginas: number;
  };
  ofertas: OfertaApi[];
}

export type DiaApi = 'LUNES' | 'MARTES' | 'MIERCOLES' | 'JUEVES' | 'VIERNES' | 'SABADO' | 'DOMINGO';

export interface OfertaApi {
  id: string;
  titulo: string;
  subtitulo: string;
  descripcion: string;
  legal: string;
  /** Observado: "DISCOUNT" | "CASHBACK_BY_MMPP". */
  tipoOfertaPrincipal: string;
  fechaInicio: string;
  fechaTermino: string;
  tieneFechaTermino: boolean;
  soloAdultos: boolean;
  prioridad: number;
  visibleApp: boolean;
  visibleWeb: boolean;
  link: string;
  slug: string;
  categorias: { id: string; titulo: string }[];
  tags: { id: string; nombre: string }[];
  leadDuration: number;
  /** imagen1/2: banner 1080x365, imagen3: tarjeta 876x579, imagen4: logo 104x104. */
  imagenes: { imagen1?: string; imagen2?: string; imagen3?: string; imagen4?: string };
  comercio: { id: string; nombre: string };
  tracking: {
    tipo?: string;
    condiciones: string;
    exclusiones?: string;
    entregaTerm: number;
    validacionTerm: number;
    requiereRut: boolean;
  };
  beneficio: {
    discount?: { porcentajeDescuento: number };
    /** Fracción: 0.07 = 7%. */
    cashback?: { porcentajeCashback: number; tope: number };
  };
  deal: {
    discount?: { percentage: number };
    cashback?: { percentage: number; tope: number };
    total?: {
      cashback: { percentage: number; tope: number };
      tarjetas: { origen: string; tipo: string; cashback: { porcentaje: number; tope: number } }[];
    };
  };
  partners: { nombre: string; codigo: string }[];
  isSegmented: boolean;
  tcAfluente?: string[];
  scheduling: {
    parentId: string | null;
    /** Estado *del día en que se consultó* (ACTIVA = aplica hoy). No sirve como dato persistente. */
    activityStatus: string;
    durationType: string;
    lastActivityStatus: string;
    isRecurrent: boolean;
    dayRecurrence: DiaApi[];
    recurrenceLabel: string;
  };
  isExclusive: boolean;
  /** Texto libre; a veces "(region): ...;(comuna): ..." o "VITACURA; VIERNES; ;". */
  keywords?: string;
  medioDePago?: { online: boolean; presencial: boolean; tarjetas: unknown[]; duracionLead: number };
  rangoBeneficio?: { porcentajeMinimo: number; porcentajeMaximo: number; tope: number };
}

// ---------------------------------------------------------------------------
// Dataset enriquecido (data/beneficios.json)
// ---------------------------------------------------------------------------

/** 0 = domingo ... 6 = sábado (igual que Date#getDay). */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TipoBeneficio = 'descuento' | 'cashback' | 'cuotas' | 'otro';

/** Qué tan exacto es el pin. */
export type PrecisionUbicacion =
  /** Se encontró el local en OpenStreetMap. */
  | 'local'
  /** Centro de un sector conocido (ej. "Mall Sport", "Barrio Italia"). */
  | 'sector'
  /** Centro de la comuna/ciudad. */
  | 'comuna';

export interface Ubicacion {
  /** Comuna oficial (ej. "Viña del Mar"). */
  comuna: string;
  region: string;
  /** Sector dentro de la comuna, si el texto lo menciona (ej. "Reñaca"). */
  sector?: string;
  lat: number;
  lng: number;
  precision: PrecisionUbicacion;
  /** Dirección de OpenStreetMap cuando precision === 'local'. */
  direccion?: string;
}

export type Alcance =
  /** Tiene una o más comunas identificadas. */
  | 'local'
  /** Todo Chile / todas las sucursales. */
  | 'nacional'
  /** Solo online / app. */
  | 'online'
  /** Solo se sabe la región. */
  | 'regional'
  | 'desconocido';

export interface Beneficio {
  id: string;
  slug: string;
  titulo: string;
  subtitulo: string;
  descripcion: string;
  legal: string;
  link: string | null;
  comercio: { id: string; nombre: string };
  imagen: string | null;
  logo: string | null;
  categorias: string[];
  tags: string[];

  tipo: TipoBeneficio;
  /** Porcentaje 0-100 (descuento o cashback). null si no aplica. */
  descuento: number | null;
  /** Tope en CLP, extraído del texto. */
  tope: number | null;
  /** Tarjetas mencionadas como válidas (ej. "Crédito", "Débito", "Visa Infinite"). */
  tarjetas: string[];
  /** Días en que aplica. Vacío = todos los días. */
  dias: DiaSemana[];
  presencial: boolean;
  online: boolean;

  fechaInicio: string;
  /** null = sin fecha de término. */
  fechaTermino: string | null;
  soloAdultos: boolean;
  exclusivo: boolean;
  prioridad: number;

  alcance: Alcance;
  regiones: string[];
  ubicaciones: Ubicacion[];
}

export interface DatasetBeneficios {
  generadoEn: string;
  fuente: string;
  total: number;
  beneficios: Beneficio[];
}
