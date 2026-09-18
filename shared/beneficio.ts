/**
 * Tipos compartidos entre el scraper y el frontend.
 *
 * `Beneficio` es la forma normalizada/enriquecida que se guarda en
 * data/beneficios.json, común a todos los bancos. Cada banco define sus propios
 * tipos crudos en scraper/bancos/<id>/tipos.ts y los normaliza a esta forma.
 *
 * Solo sintaxis "borrable" (interfaces/types, sin enums) para que Node pueda
 * ejecutar el scraper con type stripping nativo.
 */

export type { BancoId } from './bancos.ts';
import type { BancoId } from './bancos.ts';

/** 0 = domingo ... 6 = sábado (igual que Date#getDay). */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TipoBeneficio = 'descuento' | 'cashback' | 'cuotas' | 'millas' | 'otro';

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
  /** Banco emisor. Los ids son únicos entre bancos porque llevan su prefijo. */
  banco: BancoId;
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
  /** true si fechaTermino se dedujo de texto libre y puede ser imprecisa. */
  fechaTerminoAproximada?: boolean;
  soloAdultos: boolean;
  exclusivo: boolean;
  prioridad: number;

  alcance: Alcance;
  regiones: string[];
  ubicaciones: Ubicacion[];
}

/** Resumen por banco de la corrida que generó el dataset. */
export interface ResumenBanco {
  id: BancoId;
  nombre: string;
  fuente: string;
  total: number;
  /** Presente si el banco falló: el dataset conserva los datos previos de ese banco. */
  error?: string;
}

export interface DatasetBeneficios {
  generadoEn: string;
  bancos: ResumenBanco[];
  total: number;
  beneficios: Beneficio[];
}
