// Copia ../data/beneficios.json (generado por el scraper, no versionado) a public/,
// y enlaza public/img a ../data/img (las copias reducidas de las imágenes).
import fs from 'node:fs';

const origen = new URL('../../data/beneficios.json', import.meta.url);
const destino = new URL('../public/beneficios.json', import.meta.url);

if (!fs.existsSync(origen)) {
  console.error('✖ Falta data/beneficios.json. Genéralo con `node scraper` desde la raíz del repo.');
  process.exit(1);
}
fs.mkdirSync(new URL('.', destino), { recursive: true });
fs.copyFileSync(origen, destino);

// Sin data/img el sitio usa las URLs originales de los bancos.
const imagenes = new URL('../public/img', import.meta.url);
fs.rmSync(imagenes, { recursive: true, force: true });
if (fs.existsSync(new URL('../../data/img', import.meta.url))) {
  fs.symlinkSync('../../data/img', imagenes, 'dir');
}
