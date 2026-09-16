'use client';

import { memo } from 'react';
import { diasParaVencer, etiquetaDescuento, formatoPesos, textoDias, textoUbicacion } from '@/lib/formato';
import type { Beneficio } from '@/lib/tipos';

interface Props {
  b: Beneficio;
  ahora: Date;
  distanciaKm?: number;
  activo: boolean;
  onAbrir: (b: Beneficio) => void;
  onHover: (id: string | null) => void;
  onVerEnMapa?: (b: Beneficio) => void;
}

function TarjetaBeneficio({ b, ahora, distanciaKm, activo, onAbrir, onHover, onVerEnMapa }: Props) {
  const vence = diasParaVencer(b, ahora);
  const hoy = ahora.getDay();
  const todosLosDias = !b.dias.length || b.dias.length === 7;
  const aplicaHoy = todosLosDias || b.dias.includes(hoy as never);
  const ubicacion = textoUbicacion(b);
  const alto = (b.descuento ?? 0) >= 40;

  return (
    <article
      onMouseEnter={() => onHover(b.id)}
      onMouseLeave={() => onHover(null)}
      className={`group relative flex flex-col overflow-hidden rounded-2xl bg-surface ring-1 transition hover:-translate-y-0.5 hover:shadow-lg ${
        activo ? 'shadow-lg ring-2 ring-accent' : 'ring-line'
      }`}
    >
      <button type="button" onClick={() => onAbrir(b)} className="flex flex-1 flex-col text-left">
        <div className="relative aspect-[3/2] w-full overflow-hidden bg-surface-2">
          {b.imagen && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={b.imagen}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          )}
          <span
            className={`absolute left-3 top-3 rounded-full px-3 py-1 text-lg font-extrabold tracking-tight shadow-md ${
              alto ? 'bg-hot text-white' : 'bg-accent text-accent-ink'
            }`}
          >
            {etiquetaDescuento(b)}
            {b.tipo === 'cashback' && b.descuento != null && <span className="ml-1 text-xs font-semibold">cashback</span>}
          </span>
          {vence != null && vence <= 7 && (
            <span className="absolute right-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
              {vence <= 0 ? 'Vence hoy' : `Vence en ${vence} ${vence === 1 ? 'día' : 'días'}`}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <div className="flex items-center gap-2">
            {b.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logo} alt="" loading="lazy" className="h-6 w-6 shrink-0 rounded-full bg-white object-contain ring-1 ring-line" />
            )}
            <h3 className="truncate text-base font-semibold">{b.comercio.nombre}</h3>
          </div>
          <p className="line-clamp-2 text-sm text-muted">{b.titulo}</p>

          <div className="mt-auto flex flex-wrap gap-1.5 pt-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                aplicaHoy ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted'
              }`}
            >
              {aplicaHoy && !todosLosDias ? 'Hoy · ' : ''}
              {textoDias(b.dias)}
            </span>
            {ubicacion && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">📍 {ubicacion}</span>}
            {distanciaKm != null && Number.isFinite(distanciaKm) && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">
                {distanciaKm < 1 ? `${Math.round(distanciaKm * 1000)} m` : `${distanciaKm.toFixed(1)} km`}
              </span>
            )}
            {b.tope && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">Tope {formatoPesos(b.tope)}</span>}
          </div>
        </div>
      </button>

      {onVerEnMapa && b.ubicaciones.length > 0 && (
        <button
          type="button"
          onClick={() => onVerEnMapa(b)}
          className="absolute bottom-3 right-3 rounded-full bg-surface p-1.5 text-muted opacity-0 ring-1 ring-line transition hover:text-accent focus:opacity-100 group-hover:opacity-100"
          title="Ver en el mapa"
          aria-label={`Ver ${b.comercio.nombre} en el mapa`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
        </button>
      )}
    </article>
  );
}

export default memo(TarjetaBeneficio);
