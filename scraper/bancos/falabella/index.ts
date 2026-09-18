/**
 * Adaptador Banco Falabella.
 *
 * El sitio no bloquea clientes: basta `fetch`. Los datos se leen del payload
 * RSC de Next.js que trae el HTML del listado y de cada ficha. Ver api.ts.
 */
import { definirBanco } from '../../tipos.ts';
import { PAGINA, traerBeneficios } from './api.ts';
import { transformar } from './transformar.ts';

export const falabella = definirBanco({
  id: 'falabella',
  fuente: PAGINA,
  categoriasLocalFisico: ['Restaurantes', 'Antojos'],
  traer: traerBeneficios,
  transformar,
});
