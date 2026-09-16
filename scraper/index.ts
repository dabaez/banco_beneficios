/**
 * Ingesta de beneficios BCI Plus → data/beneficios.json
 *
 *   node scraper                       # trae la API + geocodifica lo nuevo
 *   node scraper --sin-geocodificar    # usa solo lo que ya está en data/geocache.json
 *
 * Variables de entorno opcionales:
 *   BCI_SUBSCRIPTION_KEY   key de Azure APIM si la rotan
 *   NOMINATIM_USER_AGENT   User-Agent identificable para Nominatim
 *   NOMINATIM_EMAIL        email de contacto para Nominatim
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatasetBeneficios } from '../shared/beneficio.ts';
import { API_URL, ErrorSubscriptionKey, traerTodasLasOfertas } from './api.ts';
import { Geocodificador, geocodificarBeneficios } from './geocodificar.ts';
import { transformar } from './transformar.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVO_DATOS = path.join(RAIZ, 'data', 'beneficios.json');
const ARCHIVO_GEOCACHE = path.join(RAIZ, 'data', 'geocache.json');

async function main() {
  const sinGeocodificar = process.argv.includes('--sin-geocodificar');

  console.log('1/3 Descargando ofertas desde la API de BCI Plus…');
  const ofertas = (await traerTodasLasOfertas()).filter((o) => o.visibleWeb !== false);
  console.log(`  ${ofertas.length} ofertas`);

  console.log('2/3 Normalizando…');
  const items = ofertas.map(transformar);

  console.log(`3/3 Geocodificando con Nominatim${sinGeocodificar ? ' (solo caché)' : ''}…`);
  const geo = new Geocodificador(ARCHIVO_GEOCACHE, sinGeocodificar);
  const beneficios = await geocodificarBeneficios(items, geo);
  beneficios.sort((a, b) => a.id.localeCompare(b.id)); // orden estable → diffs legibles en git

  const dataset: DatasetBeneficios = {
    generadoEn: new Date().toISOString(),
    fuente: API_URL,
    total: beneficios.length,
    beneficios,
  };
  fs.mkdirSync(path.dirname(ARCHIVO_DATOS), { recursive: true });
  fs.writeFileSync(ARCHIVO_DATOS, JSON.stringify(dataset, null, 1) + '\n');

  const conPin = beneficios.filter((b) => b.ubicaciones.length).length;
  console.log(`✔ ${path.relative(RAIZ, ARCHIVO_DATOS)}: ${beneficios.length} beneficios, ${conPin} con pin en el mapa.`);
}

main().catch((err) => {
  if (err instanceof ErrorSubscriptionKey) {
    console.error(`\n✖ ${err.message}\n`);
    process.exit(2);
  }
  console.error('\n✖ Error en el scraper:', err);
  process.exit(1);
});
