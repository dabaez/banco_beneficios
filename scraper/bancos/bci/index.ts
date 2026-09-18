/**
 * Adaptador BCI Plus.
 *
 * La API es pública (solo pide una subscription key de Azure APIM que el propio
 * sitio expone) y responde a `fetch` plano, así que no necesita dependencias.
 */
import { definirBanco } from '../../tipos.ts';
import { API_URL, traerTodasLasOfertas } from './api.ts';
import { transformar } from './transformar.ts';

export const bci = definirBanco({
  id: 'bci',
  fuente: API_URL,
  categoriasLocalFisico: ['Restaurantes', 'Antojos'],
  async traer() {
    const ofertas = await traerTodasLasOfertas();
    return ofertas.filter((o) => o.visibleWeb !== false);
  },
  transformar,
});
