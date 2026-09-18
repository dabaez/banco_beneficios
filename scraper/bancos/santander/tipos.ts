/**
 * Respuesta cruda de banco.santander.cl/beneficios/promociones.json
 * (inspeccionada el 2026-09-17, 308 promociones en una sola página).
 *
 * El sitio es un CMS: casi todo el dato estructurado vive en `tags` (un tag por
 * día, por categoría y por tarjeta) y en `custom_fields` (texto libre).
 * Los campos `discount`, `start_date`, `end_date`, `latitude` y `longitude`
 * existen en el esquema pero vienen vacíos en las 308 promociones, así que el
 * porcentaje y la vigencia se extraen del texto (ver transformar.ts).
 */

export interface RespuestaPromociones {
  promociones: PromocionApi[];
  meta: { total_entries: number; per_page: number; current_page: number; total_pages: number };
}

/** Cada campo custom viene como { id, value }; `value` siempre es texto (a veces ""). */
export interface CampoCustom {
  id: number;
  value: string;
}

export interface PromocionApi {
  id: number;
  uuid: string;
  title: string;
  slug: string;
  excerpt: string;
  description: string;
  conditions: string;
  url: string;
  /** [logo, imagen de detalle] — URLs absolutas. */
  covers: string[];
  /** Slugs: "cat-sabores", "miercoles", "tarjetas-credito", "metropolitana"… */
  tags: string[];
  category: string | null;
  site_id: number;
  created_at: string;
  updated_at: string;
  published_at: string;
  /** Vacíos en toda la muestra; se conservan por si el CMS empieza a llenarlos. */
  discount: string | number | null;
  start_date: string | null;
  end_date: string | null;
  location_street: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  custom_fields: Record<string, CampoCustom>;
}
