/**
 * Datos crudos de BancoEstado, tal como se extraen del HTML de su sitio
 * (inspeccionado el 2026-09-18).
 *
 * BancoEstado no tiene API de beneficios: el sitio es AEM y cada página de
 * listado trae todas sus tarjetas ya renderizadas (ocultas con `hidden` hasta
 * que el JS filtra). Hay cuatro listados, uno por pestaña que no filtra en la
 * misma página:
 *   todos        "todos-beneficios": viajes, bienestar, hogar, impacto verde…
 *   bieneficios  campaña "Bieeeneficios que te vienen bien"
 *   sabores      restaurantes; cada tarjeta trae un modal con locales y vigencia
 *   panoramas    recitales y eventos; el modal trae las bases legales
 *
 * Las tarjetas "normal" y "bieneficio" enlazan a una ficha con el detalle. Hay
 * dos plantillas de ficha: con secciones rotuladas (Detalle, Dónde, Medios de
 * Pago, Vigencia) y de texto libre ("Vigencia de la promoción: …"). Por eso
 * además de las secciones se guarda el texto completo.
 */

export type PaginaListado = 'todos' | 'bieneficios' | 'sabores' | 'panoramas';

export interface TarjetaCruda {
  pagina: PaginaListado;
  /** Variante del componente: "normal", "bieneficio", "sabores" o "evento". */
  variante: string;
  /** `data-card-id`: slug del comercio, no siempre único dentro de una página. */
  id: string;
  /** `data-name`: nombre del comercio. */
  nombre: string;
  /** `data-category` sin "todos" (ej. ["viajes"], ["sabores"]). */
  categorias: string[];
  /**
   * `data-subfiltros`: lo más estructurado que hay. Claves observadas:
   * medio, tarjeta, dia, tipo, modalidad, zona, mall, opciones.
   */
  subfiltros: Record<string, string[]>;
  /** Textos visibles de la tarjeta, en orden. Qué es cada uno depende de la variante. */
  pretitulo: string;
  titulo: string;
  subtitulo: string;
  descripcion: string;
  /** URL absoluta del logo o imagen. */
  imagen: string | null;
  /** URL absoluta del botón (ficha de detalle o sitio del comercio). */
  link: string | null;
  modal: ModalCrudo | null;
  /** Solo en panoramas: lugar y fecha del evento. */
  evento: { lugar: string; fecha: string } | null;
  /** Ficha de detalle, si la tarjeta enlaza a una del sitio y se pudo leer. */
  detalle: DetalleCrudo | null;
}

export interface ModalCrudo {
  /** Párrafos del modal (sabores: tarjeta/tope y vigencia; panoramas: bases legales). */
  textos: string[];
  /** "Locales disponibles" (sabores): una dirección por ítem. */
  locales: string[];
  /** Botón "Más información" (Instagram o sitio del comercio). */
  link: string | null;
}

export interface DetalleCrudo {
  url: string;
  /** Último ítem de la miga de pan (ej. "OK Parking"). */
  titulo: string;
  /** Plantilla con secciones: { "Detalle": "...", "Medios de Pago": "...", "Vigencia": "..." }. */
  secciones: Record<string, string>;
  /** Todos los textos del contenido (sin menú ni pie), en orden. */
  textos: string[];
  /** Párrafo de bases legales, si se identificó. */
  legal: string;
  /** Última modificación en AEM (`repo:modifyDate`), ISO. */
  modificado: string | null;
}
