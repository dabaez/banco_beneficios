/**
 * Detección de ubicaciones a partir del texto de una oferta.
 *
 * La API de BCI no entrega direcciones: la ubicación solo aparece en tags
 * ("Vitacura", "R. Metropolitana"), en `keywords` ("VITACURA; VIERNES; ;") o en
 * el título ("Miércoles - Concepción"). Aquí se reconocen comunas, sectores
 * conocidos y regiones dentro de esos textos.
 */

export const REGIONES = {
  'Arica y Parinacota': ['Arica', 'Camarones', 'Putre', 'General Lagos'],
  Tarapacá: ['Iquique', 'Alto Hospicio', 'Pozo Almonte', 'Camiña', 'Colchane', 'Huara', 'Pica'],
  Antofagasta: ['Antofagasta', 'Mejillones', 'Sierra Gorda', 'Taltal', 'Calama', 'Ollagüe', 'San Pedro de Atacama', 'Tocopilla', 'María Elena'],
  Atacama: ['Copiapó', 'Caldera', 'Tierra Amarilla', 'Chañaral', 'Diego de Almagro', 'Vallenar', 'Alto del Carmen', 'Freirina', 'Huasco'],
  Coquimbo: ['La Serena', 'Coquimbo', 'Andacollo', 'La Higuera', 'Paihuano', 'Vicuña', 'Illapel', 'Los Vilos', 'Salamanca', 'Ovalle', 'Combarbalá', 'Monte Patria', 'Punitaqui', 'Río Hurtado'],
  Valparaíso: ['Valparaíso', 'Casablanca', 'Concón', 'Juan Fernández', 'Puchuncaví', 'Quintero', 'Viña del Mar', 'Isla de Pascua', 'Los Andes', 'Calle Larga', 'Rinconada', 'San Esteban', 'La Ligua', 'Cabildo', 'Papudo', 'Petorca', 'Zapallar', 'Quillota', 'La Calera', 'Hijuelas', 'Nogales', 'San Antonio', 'Algarrobo', 'Cartagena', 'El Quisco', 'El Tabo', 'Santo Domingo', 'San Felipe', 'Catemu', 'Llaillay', 'Panquehue', 'Putaendo', 'Quilpué', 'Limache', 'Olmué', 'Villa Alemana'],
  Metropolitana: ['Santiago', 'Cerrillos', 'Cerro Navia', 'Conchalí', 'El Bosque', 'Estación Central', 'Huechuraba', 'La Cisterna', 'La Florida', 'La Granja', 'La Pintana', 'La Reina', 'Las Condes', 'Lo Barnechea', 'Lo Espejo', 'Lo Prado', 'Macul', 'Maipú', 'Ñuñoa', 'Pedro Aguirre Cerda', 'Peñalolén', 'Providencia', 'Pudahuel', 'Quilicura', 'Quinta Normal', 'Recoleta', 'Renca', 'San Joaquín', 'San Miguel', 'San Ramón', 'Vitacura', 'Puente Alto', 'Pirque', 'San José de Maipo', 'Colina', 'Lampa', 'Tiltil', 'San Bernardo', 'Buin', 'Calera de Tango', 'Paine', 'Melipilla', 'Alhué', 'Curacaví', 'María Pinto', 'Talagante', 'El Monte', 'Isla de Maipo', 'Padre Hurtado', 'Peñaflor'],
  "O'Higgins": ['Rancagua', 'Codegua', 'Coinco', 'Coltauco', 'Doñihue', 'Graneros', 'Las Cabras', 'Machalí', 'Malloa', 'Mostazal', 'Peumo', 'Pichidegua', 'Quinta de Tilcoco', 'Rengo', 'Requínoa', 'San Vicente', 'Pichilemu', 'Litueche', 'Marchigüe', 'Paredones', 'San Fernando', 'Chépica', 'Chimbarongo', 'Lolol', 'Nancagua', 'Palmilla', 'Peralillo', 'Pumanque', 'Santa Cruz'],
  Maule: ['Talca', 'Constitución', 'Curepto', 'Empedrado', 'Pelarco', 'Pencahue', 'Río Claro', 'San Clemente', 'San Rafael', 'Cauquenes', 'Chanco', 'Pelluhue', 'Curicó', 'Hualañé', 'Licantén', 'Molina', 'Rauco', 'Romeral', 'Sagrada Familia', 'Teno', 'Vichuquén', 'Linares', 'Colbún', 'Longaví', 'Parral', 'San Javier', 'Villa Alegre', 'Yerbas Buenas'],
  Ñuble: ['Chillán', 'Chillán Viejo', 'Bulnes', 'El Carmen', 'Pemuco', 'Quillón', 'San Ignacio', 'Yungay', 'Quirihue', 'Cobquecura', 'Coelemu', 'Ninhue', 'Portezuelo', 'Ránquil', 'Treguaco', 'San Carlos', 'Coihueco', 'Ñiquén', 'San Fabián', 'San Nicolás'],
  Biobío: ['Concepción', 'Coronel', 'Chiguayante', 'Hualqui', 'Lota', 'Penco', 'San Pedro de la Paz', 'Santa Juana', 'Talcahuano', 'Tomé', 'Hualpén', 'Lebu', 'Arauco', 'Cañete', 'Contulmo', 'Curanilahue', 'Los Álamos', 'Tirúa', 'Los Ángeles', 'Antuco', 'Cabrero', 'Mulchén', 'Negrete', 'Quilaco', 'Quilleco', 'San Rosendo', 'Santa Bárbara', 'Tucapel', 'Yumbel', 'Alto Biobío'],
  'La Araucanía': ['Temuco', 'Carahue', 'Cunco', 'Curarrehue', 'Galvarino', 'Gorbea', 'Lautaro', 'Loncoche', 'Melipeuco', 'Nueva Imperial', 'Padre Las Casas', 'Perquenco', 'Pitrufquén', 'Pucón', 'Saavedra', 'Teodoro Schmidt', 'Toltén', 'Vilcún', 'Villarrica', 'Cholchol', 'Angol', 'Collipulli', 'Curacautín', 'Ercilla', 'Lonquimay', 'Los Sauces', 'Lumaco', 'Purén', 'Renaico', 'Traiguén'],
  'Los Ríos': ['Valdivia', 'Lanco', 'Máfil', 'Mariquina', 'Paillaco', 'Panguipulli', 'Futrono', 'Lago Ranco', 'Río Bueno'],
  'Los Lagos': ['Puerto Montt', 'Calbuco', 'Cochamó', 'Fresia', 'Frutillar', 'Los Muermos', 'Llanquihue', 'Maullín', 'Puerto Varas', 'Ancud', 'Chonchi', 'Curaco de Vélez', 'Dalcahue', 'Puqueldón', 'Queilén', 'Quellón', 'Quemchi', 'Quinchao', 'Osorno', 'Puerto Octay', 'Purranque', 'Puyehue', 'Río Negro', 'San Juan de la Costa', 'Chaitén', 'Futaleufú', 'Hualaihué', 'Palena'],
  Aysén: ['Coyhaique', 'Lago Verde', 'Guaitecas', 'Cochrane', 'Chile Chico', 'Río Ibáñez'],
  Magallanes: ['Punta Arenas', 'Laguna Blanca', 'Río Verde', 'San Gregorio', 'Cabo de Hornos', 'Porvenir', 'Timaukel', 'Natales', 'Torres del Paine'],
} as const satisfies Record<string, readonly string[]>;

// Se omitieron a propósito comunas cuyo nombre es una palabra común o se confunde
// con otra cosa en títulos (Victoria, Independencia, Florida, Primavera, Retiro,
// Pinto, Maule, Los Lagos, O'Higgins, Aysén, Corral, Olivar, Laja, Freire, Castro,
// Placilla (O'Higgins), Nacimiento, La Cruz, San Pablo, San Pedro, Cisnes, Tortel,
// Navidad, Canela, La Estrella, La Unión...).

export type Region = keyof typeof REGIONES;

/** Sectores/lugares conocidos → comuna. Se geocodifican como "sector, comuna". */
const SECTORES: Record<string, { comuna: string; alias?: string[] }> = {
  Reñaca: { comuna: 'Viña del Mar' },
  Maitencillo: { comuna: 'Puchuncaví' },
  Curauma: { comuna: 'Valparaíso' },
  Placilla: { comuna: 'Valparaíso', alias: ['Placilla de Peñuelas'] },
  'Barrio Italia': { comuna: 'Providencia' },
  'Barrio Lastarria': { comuna: 'Santiago', alias: ['Lastarria'] },
  'Isidora Goyenechea': { comuna: 'Las Condes' },
  'Alonso de Córdova': { comuna: 'Vitacura' },
  'Galería CV': { comuna: 'Vitacura', alias: ['Galeria CV'] },
  'Mall Sport': { comuna: 'Las Condes' },
  MUT: { comuna: 'Las Condes', alias: ['Mercado Urbano Tobalaba'] },
  'Costanera Center': { comuna: 'Providencia', alias: ['Cenco Costanera'] },
  Lonquén: { comuna: 'Talagante' },
  'Santiago Centro': { comuna: 'Santiago' },
  'Puerto Natales': { comuna: 'Natales' },
};

/** Alias de región tal como aparecen en los tags ("R. Metropolitana", "R. O'higgins"). */
const ALIAS_REGION: Record<string, Region> = {
  metropolitana: 'Metropolitana',
  'region metropolitana': 'Metropolitana',
  'arica y parinacota': 'Arica y Parinacota',
  tarapaca: 'Tarapacá',
  antofagasta: 'Antofagasta',
  atacama: 'Atacama',
  coquimbo: 'Coquimbo',
  valparaiso: 'Valparaíso',
  "o'higgins": "O'Higgins",
  ohiggins: "O'Higgins",
  maule: 'Maule',
  nuble: 'Ñuble',
  biobio: 'Biobío',
  'la araucania': 'La Araucanía',
  araucania: 'La Araucanía',
  'los rios': 'Los Ríos',
  'los lagos': 'Los Lagos',
  aysen: 'Aysén',
  magallanes: 'Magallanes',
};

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Localidad {
  comuna: string;
  region: Region;
  sector?: string;
}

interface Patron {
  re: RegExp;
  largo: number;
  localidad: Localidad;
}

const REGION_DE_COMUNA = new Map<string, Region>();
for (const [region, comunas] of Object.entries(REGIONES) as [Region, readonly string[]][]) {
  for (const c of comunas) REGION_DE_COMUNA.set(c, region);
}

function escapar(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patron(nombre: string, localidad: Localidad): Patron {
  const n = normalizar(nombre);
  // Límites de palabra que funcionan con texto ya normalizado (sin tildes).
  return { re: new RegExp(`(^|[^a-z0-9])${escapar(n)}(?=$|[^a-z0-9])`), largo: n.length, localidad };
}

const PATRONES: Patron[] = [
  ...[...REGION_DE_COMUNA].map(([comuna, region]) => patron(comuna, { comuna, region })),
  ...Object.entries(SECTORES).flatMap(([sector, { comuna, alias = [] }]) => {
    const region = REGION_DE_COMUNA.get(comuna);
    if (!region) throw new Error(`Sector ${sector}: comuna desconocida ${comuna}`);
    const loc: Localidad = sector === 'Santiago Centro' || sector === 'Puerto Natales' ? { comuna, region } : { comuna, region, sector };
    return [sector, ...alias].map((n) => patron(n, loc));
  }),
].sort((a, b) => b.largo - a.largo); // el más largo primero: "San Pedro de la Paz" antes que "La Paz"

export interface ResultadoLocalidades {
  localidades: Localidad[];
  regiones: Region[];
  nacional: boolean;
}

/**
 * Busca comunas, sectores y regiones en los textos dados.
 * Cada coincidencia "consume" su tramo para que "Viña del Mar" no genere
 * también un match de otra comuna contenida en él.
 */
export function detectarLocalidades(textos: string[]): ResultadoLocalidades {
  const localidades = new Map<string, Localidad>();
  const regiones = new Set<Region>();
  let nacional = false;

  for (const original of textos) {
    let t = normalizar(original);
    if (!t) continue;

    if (/todo chile|todas las comunas|todas (las |sus )?sucursales|a nivel nacional/.test(t)) {
      // "Todo Chile excepto Arica y Parinacota..." no debe generar comunas.
      nacional = true;
      continue;
    }

    // Tags de región: "R. Metropolitana", "Region Metropolitana", "(region): Todo Chile".
    for (const m of t.matchAll(/(?:^|[^a-z])(?:r\.|region(?: de(?:l)?)?)\s*([a-z' ]+)/g)) {
      const nombre = m[1].trim();
      const region = ALIAS_REGION[nombre];
      if (region) regiones.add(region);
    }

    for (const p of PATRONES) {
      const m = p.re.exec(t);
      if (!m) continue;
      const clave = `${p.localidad.comuna}|${p.localidad.sector ?? ''}`;
      // Si ya hay un sector de esa comuna, no agregar la comuna "sola".
      const yaTieneSector = !p.localidad.sector && [...localidades.values()].some((l) => l.comuna === p.localidad.comuna);
      if (!yaTieneSector) {
        if (p.localidad.sector) localidades.delete(`${p.localidad.comuna}|`);
        localidades.set(clave, p.localidad);
      }
      const inicio = m.index + m[1].length;
      t = t.slice(0, inicio) + ' '.repeat(p.largo) + t.slice(inicio + p.largo);
    }
  }

  // "Santiago" suele usarse como la ciudad en general: si hay otra comuna de la RM, sobra.
  const otrasRM = [...localidades.values()].some((l) => l.region === 'Metropolitana' && l.comuna !== 'Santiago');
  if (otrasRM) localidades.delete('Santiago|');

  for (const l of localidades.values()) regiones.add(l.region);
  return { localidades: [...localidades.values()], regiones: [...regiones], nacional };
}
