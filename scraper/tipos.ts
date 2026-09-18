/**
 * Contrato que cumple cada banco. Todo lo específico de un banco (cómo se
 * obtienen las ofertas y cómo se normalizan) vive detrás de esta interfaz; el
 * orquestador (scraper/index.ts) y la geocodificación son agnósticos y nunca
 * ven el tipo crudo de ningún banco.
 */
import type { Beneficio } from '../shared/beneficio.ts';
import type { BancoId } from '../shared/bancos.ts';
import type { Localidad } from './localidades.ts';

/** Beneficio ya normalizado pero sin coordenadas: la geocodificación las agrega. */
export interface BeneficioSinGeo {
  beneficio: Omit<Beneficio, 'ubicaciones'>;
  localidades: Localidad[];
}

/** Lo que el orquestador necesita saber de un banco. */
export interface Banco {
  id: BancoId;
  /** URL de la fuente, para dejar registro en el dataset. */
  fuente: string;
  /**
   * Categorías de este banco que implican un local físico. Se usan para
   * intentar ubicar en OSM un comercio del que no se detectó comuna.
   */
  categoriasLocalFisico: string[];
  /** Trae las ofertas y las normaliza. Lanza `ErrorFuente` si la fuente falla. */
  traerYNormalizar(): Promise<BeneficioSinGeo[]>;
}

interface DefinicionBanco<Crudo> {
  id: BancoId;
  fuente: string;
  categoriasLocalFisico: string[];
  /**
   * Trae las ofertas crudas. Debe lanzar `ErrorFuente` cuando el problema es de
   * la fuente (key rotada, bloqueo, formato cambiado) para que el mensaje al
   * usuario sea accionable.
   */
  traer(): Promise<Crudo[]>;
  /** Normaliza una oferta cruda. `null` la descarta. */
  transformar(crudo: Crudo, indice: number): BeneficioSinGeo | null;
}

/** Une `traer` + `transformar` y esconde el tipo crudo detrás de `Banco`. */
export function definirBanco<Crudo>(def: DefinicionBanco<Crudo>): Banco {
  return {
    id: def.id,
    fuente: def.fuente,
    categoriasLocalFisico: def.categoriasLocalFisico,
    async traerYNormalizar() {
      const crudos = await def.traer();
      return crudos.map((c, i) => def.transformar(c, i)).filter((b) => b !== null);
    },
  };
}

/** Error atribuible a la fuente del banco, con instrucciones para arreglarlo. */
export class ErrorFuente extends Error {
  // Campo normal (no parámetro-propiedad): Node ejecuta este TS sin build y
  // solo admite sintaxis borrable.
  banco: BancoId;

  constructor(banco: BancoId, mensaje: string) {
    super(mensaje);
    this.banco = banco;
  }
}
