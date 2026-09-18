/**
 * Datos crudos de www.bancofalabella.cl/descuentos (inspeccionados el 2026-09-18,
 * 239 tarjetas en /descuentos/todos, 232 fichas distintas).
 *
 * El sitio es Next.js (App Router) sobre Contentful. No hay API pública: los
 * datos viajan en el payload RSC embebido en el HTML (`self.__next_f.push`).
 * El listado trae los campos de la tarjeta; la ficha (`/descuentos/detalle/<slug>`)
 * agrega categorías, canal (presencial/online), descripción y legal.
 */

/** Documento rich text de Contentful. Solo se lee su texto. */
export interface NodoRichText {
  nodeType: string;
  value?: string;
  data?: { uri?: string };
  content?: NodoRichText[];
}

/** Elemento de `benefitCardsData` en el listado. */
export interface TarjetaListado {
  benefitCard: {
    /** Comercio o gancho: "Dcto en Mall Plaza", "The Color Run". */
    title: string;
    /** Bajada: "Llegaron los Martes de Dulzura", "30% dcto". */
    description: string;
    /** "/descuentos/detalle/<slug>" — identifica al beneficio. */
    linkUrl: string;
    /** Protocolo relativo: "//images.ctfassets.net/…". */
    imageCard: string | null;
    logoCard: string | null;
    isNew: boolean;
    /** "Lunes"…"Domingo". Los 7 = todos los días. */
    discountDays: string[];
    eliteTag: boolean;
    activeCmr: boolean;
    /** Texto grande de la tarjeta en tres líneas: "Hasta" / "40%" / "Sin Tope". */
    topDiscountText: string;
    centerDiscountText: string;
    bottomDiscountText: string;
    /** ISO, con o sin zona ("2026-09-03T00:00" o "2026-07-01T04:00:00.000Z"). */
    initDate: string;
    endDate: string;
  };
  highlighted: boolean;
  /**
   * Porcentaje numérico. Ojo: vale 1 en los beneficios que no son un % (canjes,
   * montos fijos, cuotas) y falta en algunos.
   */
  discount?: number;
  limitDate?: string;
  /** "Región Metropolitana de Santiago", "Región del Biobío"… */
  region?: string[];
  /** Etiquetas rápidas: "Exclusivo Elite", "Conciertos". */
  quickFilters?: string[];
  benefitTitle: string;
  /** "CMR Mastercard", "CMR Mastercard Premium", "CMR Mastercard Elite", "Tarjeta Débito Banco Falabella". */
  creditCards?: string[];
}

/** `benefitData` de la ficha. Solo los campos que se usan o podrían servir. */
export interface DetalleFicha {
  benefitTitle: string;
  permalink: string;
  commerceName: string;
  /** Descripción larga, en rich text. */
  detailBanner1: NodoRichText | null;
  /** "Restaurantes", "Regiones", "Elite"… */
  relatedCategory: string[] | null;
  legalText: string | null;
  creditCards: string[] | null;
  region: string[] | null;
  /** "Presencial", "Online", "Delivery". */
  benefitsMode: string[] | null;
  /** Sitio del comercio, si lo hay. */
  urlCta: string | null;
  commerceInfoDescription: string | null;
  isCoupon: boolean;
  couponCode: string | null;
  /** Vacío en toda la muestra. */
  locations: unknown[] | null;
}

/** Lo que devuelve `traer`: la tarjeta del listado y su ficha, si se pudo leer. */
export interface BeneficioCrudo {
  tarjeta: TarjetaListado;
  detalle: DetalleFicha | null;
}
