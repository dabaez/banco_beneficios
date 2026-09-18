/**
 * Adaptador Banco de Chile.
 *
 * El listado del sitio se arma con la API pública de contenido de Modyo, que
 * responde a `fetch` plano: ver api.ts.
 */
import { definirBanco } from '../../tipos.ts';
import { PAGINA, traerBeneficios } from './api.ts';
import { transformar } from './transformar.ts';

export const bancochile = definirBanco({
  id: 'bancochile',
  fuente: PAGINA,
  categoriasLocalFisico: [
    'Restaurantes y Bares',
    'Cafeterías',
    'Comida Rápida',
    'Sabores Gourmet',
    '40% con todo Visa',
    '50% con Visa Infinite',
    'Dólares Premio',
  ],
  traer: traerBeneficios,
  transformar,
});
