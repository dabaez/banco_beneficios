/**
 * Preferencias que se recuerdan entre visitas en este navegador: el banco, las
 * tarjetas que el usuario tiene (por banco, porque cada uno tiene las suyas) y
 * los filtros de ubicación.
 *
 * Vive en localStorage, que puede no estar disponible (modo privado, storage
 * bloqueado): todo acceso está protegido y, si falla, se usan los valores por
 * defecto. La URL siempre tiene prioridad sobre lo guardado.
 */
import { esBancoId, type BancoId } from './tipos';

const CLAVE = 'preferencias';
/** Clave anterior, cuando solo se guardaba el banco. Se migra al leer. */
const CLAVE_BANCO_ANTIGUA = 'banco';

export interface UbicacionGuardada {
  region: string;
  comunas: string[];
  incluirNacionales: boolean;
  soloConMapa: boolean;
}

export interface Preferencias {
  banco?: BancoId;
  tarjetas: Partial<Record<BancoId, string[]>>;
  ubicacion?: UbicacionGuardada;
}

const esListaDeTextos = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Valida lo leído: el storage lo puede haber escrito otra versión del sitio. */
function sanear(crudo: unknown): Preferencias {
  const prefs: Preferencias = { tarjetas: {} };
  if (!crudo || typeof crudo !== 'object') return prefs;
  const c = crudo as Record<string, unknown>;

  if (typeof c.banco === 'string' && esBancoId(c.banco)) prefs.banco = c.banco;

  if (c.tarjetas && typeof c.tarjetas === 'object') {
    for (const [banco, lista] of Object.entries(c.tarjetas as Record<string, unknown>)) {
      if (esBancoId(banco) && esListaDeTextos(lista)) prefs.tarjetas[banco] = lista;
    }
  }

  const u = c.ubicacion as Record<string, unknown> | undefined;
  if (u && typeof u === 'object' && typeof u.region === 'string' && esListaDeTextos(u.comunas)) {
    prefs.ubicacion = {
      region: u.region,
      comunas: u.comunas,
      incluirNacionales: u.incluirNacionales === true,
      soloConMapa: u.soloConMapa === true,
    };
  }
  return prefs;
}

export function leerPreferencias(): Preferencias {
  try {
    const guardado = window.localStorage.getItem(CLAVE);
    if (guardado) return sanear(JSON.parse(guardado));
    const bancoAntiguo = window.localStorage.getItem(CLAVE_BANCO_ANTIGUA);
    return sanear({ banco: bancoAntiguo });
  } catch {
    return { tarjetas: {} };
  }
}

export function guardarPreferencias(prefs: Preferencias) {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(prefs));
    window.localStorage.removeItem(CLAVE_BANCO_ANTIGUA);
  } catch {
    // sin storage: la próxima visita parte con los valores por defecto
  }
}
