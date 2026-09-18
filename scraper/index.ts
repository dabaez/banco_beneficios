/**
 * Ingesta de beneficios bancarios → data/beneficios.json
 *
 *   node scraper                          # todos los bancos + geocodifica lo nuevo
 *   node scraper --banco bci              # solo un banco (se puede repetir)
 *   node scraper --sin-geocodificar       # usa solo lo que ya está en data/geocache.json
 *
 * Si un banco falla, los demás se guardan igual y se conservan los beneficios
 * previos del banco caído, para que el sitio nunca quede a medias.
 *
 * Variables de entorno opcionales:
 *   BCI_SUBSCRIPTION_KEY   key de Azure APIM si la rotan
 *   NOMINATIM_USER_AGENT   User-Agent identificable para Nominatim
 *   NOMINATIM_EMAIL        email de contacto para Nominatim
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Beneficio, DatasetBeneficios, ResumenBanco } from '../shared/beneficio.ts';
import { BANCOS, IDS_BANCOS, esBancoId, type BancoId } from '../shared/bancos.ts';
import { ADAPTADORES } from './bancos/index.ts';
import { Geocodificador, geocodificarBeneficios } from './geocodificar.ts';
import { ErrorFuente } from './tipos.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVO_DATOS = path.join(RAIZ, 'data', 'beneficios.json');
const ARCHIVO_GEOCACHE = path.join(RAIZ, 'data', 'geocache.json');

function parsearArgumentos(argv: string[]): { bancos: BancoId[]; sinGeocodificar: boolean } {
  const sinGeocodificar = argv.includes('--sin-geocodificar');
  const bancos: BancoId[] = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--banco') continue;
    const valor = argv[++i];
    if (!valor || !esBancoId(valor)) {
      throw new Error(`--banco "${valor ?? ''}" no existe. Opciones: ${IDS_BANCOS.join(', ')}`);
    }
    bancos.push(valor);
  }

  return { bancos: bancos.length ? [...new Set(bancos)] : IDS_BANCOS, sinGeocodificar };
}

/** Dataset anterior, para conservar los datos de un banco que falle en esta corrida. */
function leerDatasetPrevio(): DatasetBeneficios | null {
  if (!fs.existsSync(ARCHIVO_DATOS)) return null;
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_DATOS, 'utf8')) as DatasetBeneficios;
  } catch (err) {
    console.warn(`  ⚠ No se pudo leer el dataset previo (${err}); se regenera desde cero.`);
    return null;
  }
}

async function main() {
  const { bancos, sinGeocodificar } = parsearArgumentos(process.argv.slice(2));
  const previo = leerDatasetPrevio();

  const geo = new Geocodificador(ARCHIVO_GEOCACHE, sinGeocodificar);
  const beneficios: Beneficio[] = [];
  const resumenes: ResumenBanco[] = [];
  const fallaron: ErrorFuente[] = [];

  for (const id of bancos) {
    const adaptador = ADAPTADORES[id];
    const nombre = BANCOS[id].nombre;
    console.log(`\n=== ${nombre} ===`);

    try {
      console.log('1/2 Descargando y normalizando…');
      const items = await adaptador.traerYNormalizar();
      console.log(`  ${items.length} beneficios`);

      console.log(`2/2 Geocodificando con Nominatim${sinGeocodificar ? ' (solo caché)' : ''}…`);
      const conGeo = await geocodificarBeneficios(items, geo, adaptador.categoriasLocalFisico);

      beneficios.push(...conGeo);
      resumenes.push({ id, nombre, fuente: adaptador.fuente, total: conGeo.length });
    } catch (err) {
      const error = err instanceof ErrorFuente ? err : new ErrorFuente(id, String(err));
      fallaron.push(error);
      console.error(`✖ ${nombre} falló: ${error.message}`);

      // Conservar lo que había: mejor datos viejos de ese banco que ninguno.
      const anteriores = previo?.beneficios.filter((b) => b.banco === id) ?? [];
      if (anteriores.length) {
        console.error(`  ↳ se conservan ${anteriores.length} beneficios de la corrida anterior.`);
        beneficios.push(...anteriores);
      }
      resumenes.push({
        id,
        nombre,
        fuente: adaptador.fuente,
        total: anteriores.length,
        error: error.message.split('\n')[0],
      });
    }
  }

  // Bancos que no se pidieron en esta corrida: mantener sus datos y su resumen.
  for (const id of IDS_BANCOS) {
    if (bancos.includes(id)) continue;
    const anteriores = previo?.beneficios.filter((b) => b.banco === id) ?? [];
    if (!anteriores.length) continue;
    beneficios.push(...anteriores);
    const resumenPrevio = previo?.bancos.find((r) => r.id === id);
    resumenes.push(resumenPrevio ?? { id, nombre: BANCOS[id].nombre, fuente: '', total: anteriores.length });
  }

  if (!beneficios.length) {
    throw fallaron[0] ?? new Error('No se obtuvo ningún beneficio.');
  }

  beneficios.sort((a, b) => a.id.localeCompare(b.id)); // orden estable → diffs legibles en git

  const dataset: DatasetBeneficios = {
    generadoEn: new Date().toISOString(),
    bancos: resumenes.sort((a, b) => IDS_BANCOS.indexOf(a.id) - IDS_BANCOS.indexOf(b.id)),
    total: beneficios.length,
    beneficios,
  };
  fs.mkdirSync(path.dirname(ARCHIVO_DATOS), { recursive: true });
  fs.writeFileSync(ARCHIVO_DATOS, JSON.stringify(dataset, null, 1) + '\n');

  const conPin = beneficios.filter((b) => b.ubicaciones.length).length;
  console.log(`\n✔ ${path.relative(RAIZ, ARCHIVO_DATOS)}: ${beneficios.length} beneficios, ${conPin} con pin en el mapa.`);
  for (const r of dataset.bancos) {
    console.log(`  ${r.nombre}: ${r.total}${r.error ? ` (⚠ ${r.error})` : ''}`);
  }

  // Un banco caído no invalida la corrida, pero el cron debe poder detectarlo.
  if (fallaron.length) process.exitCode = 3;
}

main().catch((err) => {
  if (err instanceof ErrorFuente) {
    console.error(`\n✖ ${err.message}\n`);
    process.exit(2);
  }
  console.error('\n✖ Error en el scraper:', err);
  process.exit(1);
});
