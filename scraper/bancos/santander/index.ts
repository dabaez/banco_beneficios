/**
 * Adaptador Santander.
 *
 * Requiere Playwright: banco.santander.cl responde 403 a todo cliente que no
 * ejecute JS (Akamai Bot Manager). Ver api.ts.
 */
import { definirBanco } from '../../tipos.ts';
import { API_URL, traerPromociones } from './api.ts';
import { transformar } from './transformar.ts';

export const santander = definirBanco({
  id: 'santander',
  fuente: API_URL,
  categoriasLocalFisico: ['Restaurantes'],
  traer: traerPromociones,
  transformar,
});
