/**
 * Geocodificación con Nominatim (OpenStreetMap).
 *
 * Política de uso (https://operations.osmfoundation.org/policies/nominatim/):
 * máximo 1 request/segundo, User-Agent identificable y cachear resultados.
 * El caché (data/geocache.json) guarda la respuesta cruda compacta de cada
 * consulta, así que cambiar la lógica de selección no obliga a re-consultar, y
 * solo se consulta lo que no está en caché (locales nuevos o que cambiaron).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Beneficio, Ubicacion } from '../shared/beneficio.ts';
import { detectarLocalidades, detectarRegiones, normalizar, type Localidad, type Region } from './localidades.ts';
import type { BeneficioSinGeo } from './tipos.ts';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const INTERVALO_MS = 1100;
const TTL_MS = 365 * 24 * 3600 * 1000;
/** Las búsquedas sin resultados se reintentan antes: OSM se actualiza. */
const TTL_VACIO_MS = 90 * 24 * 3600 * 1000;
/** Distancia máxima entre un sector y el centro de su comuna. */
const MAX_KM_SECTOR = 15;
/** Un local cuya dirección no nombra la comuna se acepta solo si está así de cerca de su centro. */
const MAX_KM_LOCAL_FUERA = 3;

const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  'banco-beneficios-visor/1.0 (visor personal no oficial de beneficios; github.com/dabaez/banco_beneficios)';

interface ResultadoNominatim {
  lat: number;
  lng: number;
  nombre: string;
  clase: string;
  tipo: string;
  direccion: string;
  address: Record<string, string>;
}

interface EntradaCache {
  fecha: string;
  resultados: ResultadoNominatim[];
}

interface ArchivoCache {
  version: 1;
  consultas: Record<string, EntradaCache>;
}

/** Clases OSM que representan un local concreto (no una comuna, calle o zona). */
const CLASES_LOCAL = new Set(['amenity', 'shop', 'tourism', 'leisure', 'craft', 'office', 'building', 'healthcare', 'club']);

const PALABRAS_GENERICAS = new Set(
  (
    'restaurante restaurant resto restobar bar cafe cafeteria coffee sushi pizzeria trattoria ristorante bistro ' +
    'the la el los las de del y and food kitchen house club mall sport parrilla cocina casa tienda home ' +
    'pasteleria heladeria salones salon vip hotel teatro clinica'
  ).split(' '),
);

export class Geocodificador {
  private cache: ArchivoCache;
  private ultimoRequest = 0;
  private cambios = 0;
  private archivo: string;
  private soloCache: boolean;
  requests = 0;

  constructor(archivo: string, soloCache = false) {
    this.archivo = archivo;
    this.soloCache = soloCache;
    this.cache = fs.existsSync(archivo)
      ? (JSON.parse(fs.readFileSync(archivo, 'utf8')) as ArchivoCache)
      : { version: 1, consultas: {} };
  }

  guardar() {
    const ordenado: ArchivoCache = {
      version: 1,
      consultas: Object.fromEntries(Object.entries(this.cache.consultas).sort(([a], [b]) => a.localeCompare(b))),
    };
    fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
    fs.writeFileSync(this.archivo, JSON.stringify(ordenado, null, 1) + '\n');
    this.cambios = 0;
  }

  async buscar(q: string, limite = 5): Promise<ResultadoNominatim[]> {
    const clave = `${normalizar(q)}|${limite}`;
    const entrada = this.cache.consultas[clave];
    if (entrada) {
      const edad = Date.now() - Date.parse(entrada.fecha);
      const vigente = edad < (entrada.resultados.length ? TTL_MS : TTL_VACIO_MS);
      if (vigente || this.soloCache) return entrada.resultados;
    }
    if (this.soloCache) return [];

    const espera = this.ultimoRequest + INTERVALO_MS - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));

    const params = new URLSearchParams({
      q,
      format: 'jsonv2',
      countrycodes: 'cl',
      addressdetails: '1',
      limit: String(limite),
      'accept-language': 'es',
    });
    if (process.env.NOMINATIM_EMAIL) params.set('email', process.env.NOMINATIM_EMAIL);

    let res: Response | undefined;
    for (let intento = 0; intento < 4; intento++) {
      this.ultimoRequest = Date.now();
      this.requests++;
      res = await fetch(`${ENDPOINT}?${params}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      if (res.status !== 429 && res.status < 500) break;
      const backoff = 5000 * 2 ** intento;
      console.warn(`  ⚠ Nominatim ${res.status}, reintentando en ${backoff / 1000}s`);
      await new Promise((r) => setTimeout(r, backoff));
    }
    if (!res?.ok) throw new Error(`Nominatim respondió ${res?.status} para "${q}"`);

    const crudo = (await res.json()) as {
      lat: string;
      lon: string;
      name?: string;
      category?: string;
      type: string;
      display_name: string;
      address?: Record<string, string>;
    }[];
    const resultados = crudo.map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lon),
      nombre: r.name ?? '',
      clase: r.category ?? '',
      tipo: r.type,
      direccion: r.display_name,
      address: r.address ?? {},
    }));

    this.cache.consultas[clave] = { fecha: new Date().toISOString(), resultados };
    if (++this.cambios >= 20) this.guardar();
    return resultados;
  }

  /** Centro de una comuna. */
  async centroComuna(l: Localidad): Promise<{ lat: number; lng: number } | null> {
    const region = l.region === 'Metropolitana' ? 'Región Metropolitana' : `Región de ${l.region}`;
    const rs = await this.buscar(`${l.comuna}, ${region}, Chile`, 3);
    const mismoNombre = (x: ResultadoNominatim) => normalizar(x.nombre) === normalizar(l.comuna);
    const r =
      rs.find((x) => x.clase === 'boundary' && x.tipo === 'administrative' && mismoNombre(x)) ??
      rs.find((x) => x.clase === 'place' && ['city', 'town', 'village'].includes(x.tipo) && mismoNombre(x)) ??
      rs.find(mismoNombre) ??
      rs[0];
    return r ? { lat: r.lat, lng: r.lng } : null;
  }

  async centroSector(l: Localidad, centro: { lat: number; lng: number }): Promise<{ lat: number; lng: number } | null> {
    if (!l.sector) return null;
    const rs = await this.buscar(`${l.sector}, ${l.comuna}, Chile`, 3);
    const r = rs.find((x) => distanciaKm(x, centro) <= MAX_KM_SECTOR);
    return r ? { lat: r.lat, lng: r.lng } : null;
  }

  async local(comercio: string, l: Localidad, centro: { lat: number; lng: number }): Promise<ResultadoNominatim | null> {
    const zona = l.sector ? `${l.sector}, ${l.comuna}` : l.comuna;
    const rs = await this.buscar(`${nombreParaBuscar(comercio)}, ${zona}, Chile`);
    return (
      rs.find(
        (r) =>
          CLASES_LOCAL.has(r.clase) &&
          coincideNombre(comercio, r.nombre) &&
          enRegion(r, l.region) &&
          (direccionEnComuna(r, l.comuna) || distanciaKm(r, centro) <= MAX_KM_LOCAL_FUERA),
      ) ?? null
    );
  }

  /**
   * Un local por la dirección que entrega el banco ("Manuel Montt 697",
   * Providencia). Solo vale un punto exacto: con número de casa o un local;
   * una calle sin número cae a kilómetros del local.
   */
  async porDireccion(l: Localidad, centro: { lat: number; lng: number }): Promise<ResultadoNominatim | null> {
    if (!l.direccion) return null;
    const rs = await this.buscar(`${l.direccion}, ${l.comuna}, Chile`, 3);
    return (
      rs.find(
        (r) =>
          (r.address.house_number || CLASES_LOCAL.has(r.clase)) &&
          enRegion(r, l.region) &&
          (direccionEnComuna(r, l.comuna) || distanciaKm(r, centro) <= MAX_KM_LOCAL_FUERA),
      ) ?? null
    );
  }

  /**
   * Para locales presenciales sin comuna conocida: busca el nombre en todo Chile
   * y solo acepta si hay exactamente un resultado con ese nombre y es un local
   * (nombres comunes como "Tamango" o "Jerónimo" traen homónimos y se descartan).
   */
  async localSinComuna(comercio: string): Promise<{ r: ResultadoNominatim; localidad: Localidad } | null> {
    const rs = await this.buscar(`${nombreParaBuscar(comercio)}, Chile`);
    const homonimos = rs.filter((r) => comparteNombre(comercio, r.nombre));
    if (homonimos.length !== 1) return null;
    const r = homonimos[0];
    if (!CLASES_LOCAL.has(r.clase) || !coincideNombre(comercio, r.nombre, true)) return null;
    const a = r.address;
    const { localidades } = detectarLocalidades([a.suburb, a.city_district, a.town, a.city, a.village, a.municipality].filter(Boolean));
    // Un barrio puede llamarse como una comuna de otra región ("San Joaquín", La Serena).
    const l = localidades.find((x) => enRegion(r, x.region));
    return l ? { r, localidad: { comuna: l.comuna, region: l.region } } : null;
  }
}

function nombreParaBuscar(comercio: string): string {
  // "VR Racing - Mall Sport" → "VR Racing"; quita comillas y símbolos raros.
  return comercio.split(/\s+-\s+/)[0].replace(/[´`"]/g, '').trim();
}

function tokens(s: string): string[] {
  return normalizar(s)
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length > 1 && !PALABRAS_GENERICAS.has(t));
}

function coincideNombre(comercio: string, nombreOsm: string, estricto = false): boolean {
  if (!nombreOsm) return false;
  const a = tokens(nombreParaBuscar(comercio));
  const b = tokens(nombreOsm);
  if (!a.length || !b.length) return normalizar(nombreParaBuscar(comercio)) === normalizar(nombreOsm);
  const todosA = a.every((t) => b.includes(t));
  if (estricto) return todosA && b.every((t) => a.includes(t));
  return todosA || b.every((t) => a.includes(t));
}

/** Algún token distintivo del comercio aparece en el nombre OSM. */
function comparteNombre(comercio: string, nombreOsm: string): boolean {
  const b = tokens(nombreOsm);
  return tokens(nombreParaBuscar(comercio)).some((t) => b.includes(t));
}

/**
 * El resultado está en la región esperada. Hace falta porque `direccionEnComuna`
 * también acepta barrios homónimos: "Work Café, San Joaquín" devolvía el barrio
 * San Joaquín de La Serena, y "Burger King, San Miguel" la población San Miguel
 * de Talca. Sin `state` en la respuesta no hay cómo descartarlo: se acepta.
 */
function enRegion(r: ResultadoNominatim, region: string): boolean {
  const state = r.address.state;
  return !state || detectarRegiones([state]).includes(region as Region);
}

function direccionEnComuna(r: ResultadoNominatim, comuna: string): boolean {
  const c = normalizar(comuna);
  return Object.values(r.address).some((v) => normalizar(v) === c) || normalizar(r.direccion).includes(`, ${c},`);
}

function distanciaKm(p: { lat: number; lng: number }, q: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (q.lat - p.lat) * rad;
  const dLng = (q.lng - p.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function redondear(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Agrega coordenadas a los beneficios ya normalizados.
 * `categoriasLocalFisico` las define cada banco: son las categorías cuyos
 * comercios tienen local a la calle y vale la pena buscar en OSM sin comuna.
 */
export async function geocodificarBeneficios(
  items: BeneficioSinGeo[],
  geo: Geocodificador,
  categoriasLocalFisico: string[] = [],
): Promise<Beneficio[]> {
  const salida: Beneficio[] = [];
  const stats = { local: 0, direccion: 0, sector: 0, comuna: 0, sinCoords: 0, localSinComuna: 0 };

  for (const [i, { beneficio, localidades }] of items.entries()) {
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${items.length} (requests a Nominatim: ${geo.requests})`);
    const ubicaciones: Ubicacion[] = [];

    for (const l of localidades) {
      const centro = await geo.centroComuna(l);
      if (!centro) {
        stats.sinCoords++;
        continue;
      }
      const base = { comuna: l.comuna, region: l.region, ...(l.sector ? { sector: l.sector } : {}) };

      // Con dirección, primero la dirección: buscar por nombre puede dar otra sucursal de la comuna.
      const porDireccion = await geo.porDireccion(l, centro);
      if (porDireccion) {
        stats.direccion++;
        ubicaciones.push({ ...base, lat: redondear(porDireccion.lat), lng: redondear(porDireccion.lng), precision: 'local', direccion: porDireccion.direccion });
        continue;
      }
      const local = await geo.local(beneficio.comercio.nombre, l, centro);
      if (local) {
        stats.local++;
        ubicaciones.push({ ...base, lat: redondear(local.lat), lng: redondear(local.lng), precision: 'local', direccion: local.direccion });
        continue;
      }
      const sector = await geo.centroSector(l, centro);
      if (sector) {
        stats.sector++;
        ubicaciones.push({ ...base, lat: redondear(sector.lat), lng: redondear(sector.lng), precision: 'sector' });
        continue;
      }
      stats.comuna++;
      ubicaciones.push({ ...base, lat: redondear(centro.lat), lng: redondear(centro.lng), precision: 'comuna' });
    }

    let { alcance, regiones } = beneficio;
    const esLocalFisico = beneficio.presencial && beneficio.categorias.some((c) => categoriasLocalFisico.includes(c));
    if (!localidades.length && alcance === 'desconocido' && esLocalFisico) {
      const encontrado = await geo.localSinComuna(beneficio.comercio.nombre);
      if (encontrado) {
        stats.localSinComuna++;
        const { r, localidad } = encontrado;
        ubicaciones.push({
          comuna: localidad.comuna,
          region: localidad.region,
          lat: redondear(r.lat),
          lng: redondear(r.lng),
          precision: 'local',
          direccion: r.direccion,
        });
        alcance = 'local';
        regiones = [...new Set<Region | string>([...regiones, localidad.region])];
      }
    }

    salida.push({ ...beneficio, alcance, regiones, ubicaciones });
  }

  geo.guardar();
  console.log(
    `  Pines: ${stats.local} en el local exacto (+${stats.localSinComuna} sin comuna previa, +${stats.direccion} por dirección), ` +
      `${stats.sector} en sector, ${stats.comuna} en centro de comuna; ${stats.sinCoords} sin coordenadas.`,
  );
  return salida;
}
