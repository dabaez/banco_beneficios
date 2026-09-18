'use client';

import { useEffect, useRef } from 'react';
import {
  ETIQUETA_PRECISION,
  ETIQUETA_TIPO,
  diasParaVencer,
  etiquetaDescuento,
  formatoFecha,
  formatoPesos,
  textoDias,
  textoTarjetas,
} from '@/lib/formato';
import { BANCOS, type Beneficio } from '@/lib/tipos';

interface Props {
  b: Beneficio | null;
  ahora: Date;
  onCerrar: () => void;
  onVerEnMapa: (b: Beneficio) => void;
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

export default function DetalleBeneficio({ b, ahora, onCerrar, onVerEnMapa }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (b && !d.open) d.showModal();
    if (!b && d.open) d.close();
  }, [b]);

  const vence = b ? diasParaVencer(b, ahora) : null;

  return (
    <dialog
      ref={ref}
      onClose={onCerrar}
      onClick={(e) => e.target === ref.current && onCerrar()}
      className="m-auto w-[min(44rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-2xl bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      {b && (
        <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col">
          <div className="relative shrink-0">
            {b.imagen && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.imagen} alt="" className="aspect-[21/9] w-full object-cover" />
            )}
            <button
              type="button"
              onClick={onCerrar}
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-xl text-white hover:bg-black/80"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>

          <div className="overflow-y-auto p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className="shrink-0 rounded-2xl bg-accent px-3 py-2 text-2xl font-extrabold text-accent-ink">
                {etiquetaDescuento(b)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-accent">{b.comercio.nombre}</p>
                <h2 className="text-xl font-bold leading-tight">{b.titulo}</h2>
                {b.subtitulo && <p className="mt-1 text-sm text-muted">{b.subtitulo}</p>}
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Dato etiqueta="Tipo">{ETIQUETA_TIPO[b.tipo]}</Dato>
              <Dato etiqueta="Días">{textoDias(b.dias)}</Dato>
              <Dato etiqueta="Tope">{b.tope ? formatoPesos(b.tope) : 'Sin tope informado'}</Dato>
              <Dato etiqueta="Tarjetas">{textoTarjetas(b)}</Dato>
              <Dato etiqueta="Canal">
                {[b.presencial && 'Presencial', b.online && 'Online'].filter(Boolean).join(' y ') || '—'}
              </Dato>
              <Dato etiqueta="Vigencia">
                {b.fechaTermino ? (
                  <>
                    {b.fechaTerminoAproximada ? 'Aprox. hasta ' : 'Hasta '}
                    {formatoFecha(b.fechaTermino)}
                    {vence != null && vence <= 14 && <span className="text-hot"> ({vence <= 0 ? 'hoy' : `${vence} d`})</span>}
                  </>
                ) : (
                  'Sin fecha de término'
                )}
              </Dato>
            </dl>

            {(b.ubicaciones.length > 0 || b.alcance !== 'local') && (
              <section className="mt-5">
                <h3 className="text-sm font-semibold">Dónde</h3>
                {b.ubicaciones.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {b.ubicaciones.map((u) => (
                      <li key={`${u.lat},${u.lng}`} className="flex items-start justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {u.sector ? `${u.sector}, ` : ''}
                            {u.comuna} <span className="font-normal text-muted">· {u.region}</span>
                          </p>
                          <p className="truncate text-xs text-muted" title={u.direccion}>
                            {u.direccion ?? ETIQUETA_PRECISION[u.precision]}
                          </p>
                        </div>
                        <a
                          className="shrink-0 text-xs font-medium text-accent hover:underline"
                          target="_blank"
                          rel="noreferrer"
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                            `${b.comercio.nombre} ${u.sector ?? ''} ${u.comuna}`,
                          )}`}
                        >
                          Google Maps ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted">
                    {b.alcance === 'online'
                      ? 'Beneficio online.'
                      : b.alcance === 'nacional'
                        ? 'Válido en todo Chile / todas las sucursales.'
                        : b.regiones.length
                          ? `Región: ${b.regiones.join(', ')}.`
                          : 'La fuente no indica la ubicación.'}
                  </p>
                )}
                {b.ubicaciones.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onVerEnMapa(b)}
                    className="mt-2 text-sm font-medium text-accent hover:underline"
                  >
                    Ver en el mapa
                  </button>
                )}
              </section>
            )}

            <section className="mt-5">
              <h3 className="text-sm font-semibold">Detalle</h3>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted">{b.descripcion}</p>
            </section>

            {b.legal && (
              <details className="mt-4 rounded-xl bg-surface-2 px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold">Términos y condiciones</summary>
                <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted">{b.legal}</p>
              </details>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {b.link && (
                <a
                  href={b.link}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:opacity-90"
                >
                  Ir al sitio del comercio ↗
                </a>
              )}
              <p className="text-xs text-muted">
                Verifica siempre las condiciones en los canales oficiales de {BANCOS[b.banco].nombre} antes de usar el beneficio.
              </p>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
