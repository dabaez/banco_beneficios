/**
 * Registro de bancos soportados, compartido entre el scraper y el frontend.
 *
 * Aquí va solo metadata declarativa (nombre, tarjetas, color). La forma de
 * obtener y normalizar los datos vive en scraper/bancos/<id>/.
 *
 * Para agregar un banco: añádelo aquí y crea su adaptador en scraper/bancos/.
 */

export interface Banco {
  /** Nombre para mostrar. */
  nombre: string;
  /** Página pública de beneficios (se enlaza en el pie del sitio). */
  sitio: string;
  /**
   * Tarjetas del banco, para el filtro "mis tarjetas".
   * `base`: producto (crédito, débito…). `premium`: niveles que restringen
   * el beneficio a quien tenga esa tarjeta específica.
   */
  tarjetas: { base: string[]; premium: string[] };
  /** Color de acento de la marca, para distinguir bancos en la UI. */
  color: string;
}

export const BANCOS = {
  bci: {
    nombre: 'Bci',
    sitio: 'https://www.bci.cl/personas/beneficios',
    tarjetas: {
      base: ['Crédito', 'Débito'],
      premium: ['Visa Infinite', 'Visa Signature', 'Mastercard Black', 'Platinum'],
    },
    color: '#f5a300',
  },
  santander: {
    nombre: 'Santander',
    sitio: 'https://banco.santander.cl/beneficios/',
    tarjetas: {
      // Las del filtro de tarjetas de su sitio. "Empresas" es la de crédito
      // Santander Empresas: no es premium, es otra tarjeta con sus beneficios.
      base: ['Crédito', 'Débito', 'Empresas'],
      premium: ['American Express', 'WorldMember Limited'],
    },
    color: '#ec0000',
  },
  bancoestado: {
    nombre: 'BancoEstado',
    sitio: 'https://www.bancoestado.cl/content/bancoestado-public/cl/es/home/home/todosuma---bancoestado-personas/todos-beneficios.html',
    tarjetas: {
      // CuentaRUT es una débito, pero hay beneficios que la incluyen o la
      // excluyen explícitamente. Rutpay es la billetera y a veces tiene su propio descuento.
      base: ['Crédito', 'Débito', 'CuentaRUT', 'Rutpay'],
      // No hay niveles premium: lo que restringe es la marca de la tarjeta de
      // crédito (la mayoría de los restaurantes son "exclusivo Visa").
      premium: ['Visa', 'Mastercard'],
    },
    color: '#f15b12',
  },
  falabella: {
    nombre: 'Banco Falabella',
    sitio: 'https://www.bancofalabella.cl/descuentos/todos',
    tarjetas: {
      // "Crédito" es la CMR Mastercard; Premium y Elite son sus niveles, y hay
      // beneficios exclusivos Elite. La débito es la de Cuenta Corriente/Vista.
      base: ['Crédito', 'Débito'],
      premium: ['CMR Premium', 'CMR Elite'],
    },
    color: '#007937',
  },
  bancochile: {
    nombre: 'Banco de Chile',
    sitio: 'https://sitiospublicos.bancochile.cl/personas/beneficios/todos-los-beneficios',
    tarjetas: {
      // La débito es Visa. "Visa"/"Mastercard" marcan los beneficios que excluyen
      // la otra marca (los "40% con todo Visa"); Infinite, Signature y Black, los
      // exclusivos de esos niveles (crédito o débito).
      base: ['Crédito', 'Débito'],
      premium: ['Visa', 'Mastercard', 'Visa Infinite', 'Visa Signature', 'Mastercard Black'],
    },
    color: '#011083',
  },
} as const satisfies Record<string, Banco>;

export type BancoId = keyof typeof BANCOS;

export const IDS_BANCOS = Object.keys(BANCOS) as BancoId[];

export function esBancoId(s: string): s is BancoId {
  return Object.hasOwn(BANCOS, s);
}

export function nombreBanco(id: BancoId): string {
  return BANCOS[id].nombre;
}

/** Todas las tarjetas de todos los bancos, sin repetir, en orden de banco. */
export function todasLasTarjetas(): { banco: BancoId; base: string[]; premium: string[] }[] {
  return IDS_BANCOS.map((id) => ({
    banco: id,
    base: [...BANCOS[id].tarjetas.base],
    premium: [...BANCOS[id].tarjetas.premium],
  }));
}
