import type { Beneficio, DiaSemana, PrecisionUbicacion, TipoBeneficio } from './tipos';

export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;
export const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
/** Orden de despliegue: lunes primero. */
export const ORDEN_DIAS: DiaSemana[] = [1, 2, 3, 4, 5, 6, 0];

export const ETIQUETA_TIPO: Record<TipoBeneficio, string> = {
  descuento: 'Descuento',
  cashback: 'Cashback',
  cuotas: 'Cuotas sin interés',
  otro: 'Otros',
};

export const ETIQUETA_PRECISION: Record<PrecisionUbicacion, string> = {
  local: 'Ubicación del local',
  sector: 'Ubicación aproximada (sector)',
  comuna: 'Ubicación aproximada (centro de la comuna)',
};

const pesos = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const fecha = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });

export const formatoPesos = (n: number) => pesos.format(n);
export const formatoFecha = (iso: string) => fecha.format(new Date(iso));

export function textoDias(dias: DiaSemana[]): string {
  if (!dias.length || dias.length === 7) return 'Todos los días';
  const orden = ORDEN_DIAS.filter((d) => dias.includes(d));
  return orden.map((d) => DIAS_CORTOS[d]).join(' · ');
}

export function diasParaVencer(b: Beneficio, ahora: Date): number | null {
  if (!b.fechaTermino) return null;
  return Math.ceil((Date.parse(b.fechaTermino) - ahora.getTime()) / 86_400_000);
}

export function etiquetaDescuento(b: Beneficio): string {
  if (b.descuento != null) return `${Number.isInteger(b.descuento) ? b.descuento : b.descuento.toFixed(1)}%`;
  if (b.tipo === 'cuotas') return 'Cuotas';
  if (b.tipo === 'cashback') return 'Cashback';
  return 'Beneficio';
}

export function textoUbicacion(b: Beneficio): string {
  if (b.ubicaciones.length) {
    const comunas = [...new Set(b.ubicaciones.map((u) => u.sector ?? u.comuna))];
    return comunas.length > 2 ? `${comunas.slice(0, 2).join(', ')} +${comunas.length - 2}` : comunas.join(', ');
  }
  if (b.alcance === 'online') return 'Online';
  if (b.alcance === 'nacional') return 'Todo Chile';
  if (b.regiones.length) return b.regiones.join(', ');
  return '';
}
