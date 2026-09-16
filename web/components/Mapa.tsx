'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { ETIQUETA_PRECISION, etiquetaDescuento, textoDias } from '@/lib/formato';
import type { Beneficio, Ubicacion } from '@/lib/tipos';

interface Grupo {
  clave: string;
  lat: number;
  lng: number;
  aproximado: boolean;
  items: { b: Beneficio; u: Ubicacion }[];
}

interface Props {
  beneficios: Beneficio[];
  activoId: string | null;
  enfocar: { id: string; n: number } | null;
  onSeleccionar: (b: Beneficio) => void;
  miUbicacion: { lat: number; lng: number } | null;
}

const CENTRO_CHILE: [number, number] = [-33.45, -70.65];

function agrupar(beneficios: Beneficio[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const b of beneficios) {
    for (const u of b.ubicaciones) {
      const clave = `${u.lat.toFixed(5)},${u.lng.toFixed(5)}`;
      let g = grupos.get(clave);
      if (!g) {
        g = { clave, lat: u.lat, lng: u.lng, aproximado: u.precision !== 'local', items: [] };
        grupos.set(clave, g);
      }
      if (!g.items.some((x) => x.b.id === b.id)) g.items.push({ b, u });
    }
  }
  for (const g of grupos.values()) g.items.sort((x, y) => (y.b.descuento ?? -1) - (x.b.descuento ?? -1));
  return [...grupos.values()];
}

function icono(g: Grupo, activo: boolean): L.DivIcon {
  const mejor = g.items[0].b;
  const clases = ['pin', g.aproximado ? 'pin--aprox' : '', activo ? 'pin--activo' : ''].join(' ');
  const extra = g.items.length > 1 ? `<span class="pin__n">+${g.items.length - 1}</span>` : '';
  return L.divIcon({
    className: '',
    html: `<div class="${clases}">${etiquetaDescuento(mejor)}${extra}</div>`,
    iconSize: [0, 0],
  });
}

/** Ajusta la vista a los pines cuando cambia el resultado del filtro. */
function AjustarVista({ grupos }: { grupos: Grupo[] }) {
  const map = useMap();
  const firma = grupos.map((g) => g.clave).join(';');
  useEffect(() => {
    if (!grupos.length) return;
    const bounds = L.latLngBounds(grupos.map((g) => [g.lat, g.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, map]);
  return null;
}

function Enfocar({ grupos, enfocar, markers }: { grupos: Grupo[]; enfocar: Props['enfocar']; markers: React.RefObject<Map<string, L.Marker>> }) {
  const map = useMap();
  useEffect(() => {
    if (!enfocar) return;
    const g = grupos.find((x) => x.items.some((i) => i.b.id === enfocar.id));
    if (!g) return;
    map.flyTo([g.lat, g.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
    const t = setTimeout(() => markers.current?.get(g.clave)?.openPopup(), 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enfocar]);
  return null;
}

/** Leaflet no se entera de cambios de tamaño del contenedor (p.ej. al cambiar de pestaña). */
function InvalidarTamano() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function Mapa({ beneficios, activoId, enfocar, onSeleccionar, miUbicacion }: Props) {
  const grupos = useMemo(() => agrupar(beneficios), [beneficios]);
  const markers = useRef(new Map<string, L.Marker>());
  const sinUbicacion = beneficios.filter((b) => !b.ubicaciones.length).length;

  return (
    <div className="relative h-full w-full">
      <MapContainer center={CENTRO_CHILE} zoom={11} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <AjustarVista grupos={grupos} />
        <Enfocar grupos={grupos} enfocar={enfocar} markers={markers} />
        <InvalidarTamano />
        {miUbicacion && (
          <Marker
            position={[miUbicacion.lat, miUbicacion.lng]}
            icon={L.divIcon({
              className: '',
              html: '<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 4px rgb(37 99 235 / .3);transform:translate(-50%,-50%)"></div>',
              iconSize: [0, 0],
            })}
          />
        )}
        {grupos.map((g) => {
          const activo = !!activoId && g.items.some((i) => i.b.id === activoId);
          return (
            <Marker
              key={g.clave}
              position={[g.lat, g.lng]}
              icon={icono(g, activo)}
              zIndexOffset={activo ? 1000 : g.aproximado ? 0 : 100}
              ref={(m) => {
                if (m) markers.current.set(g.clave, m);
                else markers.current.delete(g.clave);
              }}
            >
              <Popup maxWidth={300} minWidth={240}>
                <div className="max-h-72 overflow-y-auto">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    {g.items[0].u.sector ? `${g.items[0].u.sector}, ` : ''}
                    {g.items[0].u.comuna} · {ETIQUETA_PRECISION[g.items[0].u.precision]}
                  </p>
                  <ul className="space-y-2">
                    {g.items.map(({ b, u }) => (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => onSeleccionar(b)}
                          className="flex w-full items-start gap-2 rounded-md p-1 text-left hover:bg-gray-100"
                        >
                          <span className="mt-0.5 shrink-0 rounded bg-teal-700 px-1.5 py-0.5 text-xs font-bold text-white">
                            {etiquetaDescuento(b)}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-semibold leading-tight text-gray-900">{b.comercio.nombre}</span>
                            <span className="block text-xs leading-snug text-gray-600">{b.titulo}</span>
                            <span className="block text-xs text-gray-500">{textoDias(b.dias)}</span>
                            {u.direccion && (
                              <span className="block truncate text-[11px] text-gray-400" title={u.direccion}>
                                {u.direccion}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-lg bg-surface/95 px-3 py-2 text-xs text-muted shadow-md ring-1 ring-line">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-6 rounded-full border-2 border-white bg-teal-700 shadow" /> local encontrado
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="inline-block h-3.5 w-6 rounded-full border-2 border-dashed border-teal-700 bg-white" /> ubicación aproximada
        </div>
        {sinUbicacion > 0 && <div className="mt-1">{sinUbicacion} sin ubicación (online / todo Chile)</div>}
      </div>
    </div>
  );
}
