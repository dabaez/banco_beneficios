// Copia ../data/beneficios.json (generado por el scraper, no versionado) a public/.
import fs from 'node:fs';

const origen = new URL('../../data/beneficios.json', import.meta.url);
const destino = new URL('../public/beneficios.json', import.meta.url);

if (!fs.existsSync(origen)) {
  console.error('✖ Falta data/beneficios.json. Genéralo con `node scraper` desde la raíz del repo.');
  process.exit(1);
}
fs.mkdirSync(new URL('.', destino), { recursive: true });
fs.copyFileSync(origen, destino);
