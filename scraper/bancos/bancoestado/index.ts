/**
 * Adaptador BancoEstado.
 *
 * Requiere Playwright: www.bancoestado.cl está detrás de Akamai y sus
 * beneficios solo existen como HTML renderizado (no hay API). Ver api.ts.
 */
import { definirBanco } from '../../tipos.ts';
import { PAGINA, traerTarjetas } from './api.ts';
import { deduplicar, transformar } from './transformar.ts';

export const bancoestado = definirBanco({
  id: 'bancoestado',
  fuente: PAGINA,
  categoriasLocalFisico: ['Restaurantes'],
  async traer() {
    return deduplicar(await traerTarjetas());
  },
  transformar,
});
