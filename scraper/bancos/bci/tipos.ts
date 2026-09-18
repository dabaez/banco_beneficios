/**
 * Respuesta cruda de la API de BCI Plus.
 * GET https://api.bciplus.cl/bff-loyalty-beneficios/v1/offers (inspeccionada el 2026-09-15).
 */

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
