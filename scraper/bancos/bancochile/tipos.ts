/**
 * Datos crudos de sitiospublicos.bancochile.cl (inspeccionados el 2026-09-18,
 * 856 beneficios en 9 páginas).
 *
 * El sitio corre sobre Modyo y el listado "Todos los beneficios" lo arma en el
 * navegador con la API de contenido del CMS, que es pública:
 *   /api/content/spaces/personas/types/beneficios/entries?per_page=100&page=N
 * "Todos" muestra todas las entradas sin filtrar, así que la API = el listado.
 */

/** Archivo subido al CMS (logo, portada). */
export interface Archivo {
  url: string;
  thumb?: string;
  alt_text?: string | null;
}

export interface Entrada {
  meta: {
    name: string;
    /** Identifica al beneficio; la ficha es /personas/beneficios/detalle/<slug>. */
    slug: string;
    uuid: string;
    /**
     * Mezcla de días ("lunes", "todos-los-dias"), lugares ("metropolitana de
     * santiago", "las condes", "todo-chile") y campañas ("fiestaspatrias2026").
     */
    tags: string[];
    /** "beneficios/sabores/restaurantes-y-bares". */
    category: string;
    category_slug: string;
    created_at: string;
    updated_at: string;
    published_at: string;
    /** Cuando el CMS la despublica: es la vigencia real en el sitio. */
    unpublish_at: string | null;
  };
  fields: {
    /** Nombre del comercio o del evento: "SKY BAR", "Creamfields Chile 2026 - 14 y 15 de noviembre". */
    Titulo: string;
    /** Titular separado por ";": "20%; dto.", "Hasta; 25% dto.", "Disfruta 2x1; en entradas al cine". Vacío en cuotas y eventos. */
    'Tipo Beneficio': string;
    /** Bajada: "lunes y martes presencial", "Paga en 4 a 12 cuotas sin interés.". */
    Extracto: string;
    /** HTML: párrafo del comercio y una lista con las condiciones. */
    Descripcion: string;
    /** "Promoción válida hasta el 31 de marzo de 2027." */
    Vigencia: string;
    'Condiciones Comerciales': string;
    /**
     * HTML `<ul><li>…</li></ul>`, un local por ítem con campos separados por ";":
     *   "nombre o VACIO;dirección;región;comuna;teléfono o VACIO[;lat;lng]"
     * A veces sobra un campo al principio ("IG:&nbsp;@cuenta;…"). Las
     * coordenadas, cuando vienen, no siempre son del local.
     */
    Sucursales: string;
    /** "visa-credito-infinite", "mastercard-credito-black"… o "All". */
    'Tarjetas Permitidas': string[];
    Logo: Archivo | null;
    Portada: Archivo | null;
    'Sitio web': string;
    Url: string;
    'Url Beneficio Externa': string;
    Keywords: string;
    Telefono: string;
  };
}

export interface RespuestaEntradas {
  entries: Entrada[];
  meta: { total_entries: number; per_page: number; current_page: number; total_pages: number };
}
