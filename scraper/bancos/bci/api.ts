import { ErrorFuente } from '../../tipos.ts';
import type { OfertaApi, RespuestaOfertasApi } from './tipos.ts';

export const API_URL = 'https://api.bciplus.cl/bff-loyalty-beneficios/v1/offers';
const ITEMS_POR_PAGINA = 100;
/** Corte de seguridad por si la API dejara de respetar la paginación. */
const MAX_PAGINAS = 50;

/**
 * Subscription key pública de Azure API Management que usa el sitio de BCI.
 * Se puede sobreescribir con BCI_SUBSCRIPTION_KEY si la rotan.
 */
const SUBSCRIPTION_KEY_FALLBACK = 'fa981752762743668413b68821a43840';

function headers(): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'Ocp-Apim-Subscription-Key': process.env.BCI_SUBSCRIPTION_KEY || SUBSCRIPTION_KEY_FALLBACK,
    Origin: 'https://www.bci.cl',
    Referer: 'https://www.bci.cl/',
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  };
}

async function traerPagina(pagina: number): Promise<RespuestaOfertasApi> {
  const url = `${API_URL}?itemsPorPagina=${ITEMS_POR_PAGINA}&pagina=${pagina}`;
  const res = await fetch(url, { headers: headers() });

  if (res.status === 401 || res.status === 403) {
    throw new ErrorFuente(
      'bci',
      `La API respondió ${res.status}: probablemente rotaron la subscription key.\n` +
        '  1. Abre https://www.bci.cl/beneficios con las DevTools (pestaña Network).\n' +
        '  2. Busca la request a api.bciplus.cl/.../offers y copia el header "Ocp-Apim-Subscription-Key".\n' +
        '  3. Ponla en BCI_SUBSCRIPTION_KEY (en el droplet: archivo .env en la raíz del repo) o actualiza el fallback en scraper/bancos/bci/api.ts.',
    );
  }
  if (!res.ok) {
    throw new Error(`La API respondió ${res.status} en la página ${pagina}: ${(await res.text()).slice(0, 300)}`);
  }

  const json = (await res.json()) as RespuestaOfertasApi;
  if (!json || !Array.isArray(json.ofertas)) {
    throw new Error(`Respuesta inesperada en la página ${pagina}: no trae "ofertas". ¿Cambió el formato de la API?`);
  }
  return json;
}

/** Trae todas las páginas hasta que una venga con menos de ITEMS_POR_PAGINA. */
export async function traerTodasLasOfertas(): Promise<OfertaApi[]> {
  const ofertas: OfertaApi[] = [];
  let total: number | undefined;

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const { ofertas: lote, paginado } = await traerPagina(pagina);
    total ??= paginado?.cantidadTotal;
    ofertas.push(...lote);
    console.log(`  página ${pagina}: ${lote.length} ofertas`);
    if (lote.length < ITEMS_POR_PAGINA) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // La API podría repetir ítems entre páginas si el orden cambia durante la corrida.
  const unicas = [...new Map(ofertas.map((o) => [o.id, o])).values()];
  if (total !== undefined && unicas.length !== total) {
    console.warn(`  ⚠ La API reporta ${total} ofertas pero se obtuvieron ${unicas.length} únicas.`);
  }
  return unicas;
}
