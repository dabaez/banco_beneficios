'use client';

import dynamic from 'next/dynamic';
import { useCallback, useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  FILTROS_INICIALES,
  aplicarFiltros,
  contarFiltrosActivos,
  distanciaMinima,
  estaVigente,
  filtrosAUrl,
  filtrosDesdeUrl,
  filtrosLimpios,
  ordenar,
  textoBuscable,
  type Filtros,
  type Orden,
} from '@/lib/filtros';
import { DIAS_CORTOS, ETIQUETA_TIPO, formatoFecha } from '@/lib/formato';
import {
  BANCOS,
  IDS_BANCOS,
  type BancoId,
  type Beneficio,
  type DatasetBeneficios,
  type DiaSemana,
} from '@/lib/tipos';
import { guardarPreferencias, leerPreferencias } from '@/lib/preferencias';
import DetalleBeneficio from './DetalleBeneficio';
import PanelFiltros, { type Facetas } from './PanelFiltros';
import TarjetaBeneficio from './TarjetaBeneficio';

const Mapa = dynamic(() => import('./Mapa'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center bg-surface-2 text-muted">Cargando mapa…</div>,
});

const ORDENES: [Orden, string][] = [
  ['descuento', 'Mayor descuento'],
  ['alfabetico', 'Comercio A–Z'],
  ['vence', 'Vencen antes'],
  ['nuevos', 'Más recientes'],
  ['relevancia', 'Destacados por el banco'],
  ['cercania', 'Más cerca de mí'],
];

function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}

function contar<T extends string>(valores: T[]): [T, number][] {
  const m = new Map<T, number>();
  for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
}

export default function Visor() {
  const [data, setData] = useState<DatasetBeneficios | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Filtros>(FILTROS_INICIALES);
  const [ahora, setAhora] = useState<Date | null>(null);
  const [seleccionado, setSeleccionado] = useState<Beneficio | null>(null);
  const [activoId, setActivoId] = useState<string | null>(null);
  const [enfocar, setEnfocar] = useState<{ id: string; n: number } | null>(null);
  const [vista, setVista] = useState<'lista' | 'mapa'>('lista');
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [miUbicacion, setMiUbicacion] = useState<{ lat: number; lng: number } | null>(null);
  const [errorUbicacion, setErrorUbicacion] = useState<string | null>(null);
  const pantallaAncha = useMediaQuery('(min-width: 1280px)');

  useEffect(() => {
    // Estado que depende del navegador: se inicializa tras montar para no romper la hidratación.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setF(filtrosDesdeUrl(window.location.search, leerPreferencias()));
    setAhora(new Date());
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/beneficios.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DatasetBeneficios) => {
        setData(d);
        // Si el banco elegido no tiene datos (ej. su scraper nunca corrió), caer al primero que sí.
        const conDatos = IDS_BANCOS.filter((id) => d.beneficios.some((b) => b.banco === id));
        setF((prev) => (conDatos.length && !conDatos.includes(prev.banco) ? { ...prev, banco: conDatos[0] } : prev));
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!ahora) return;
    window.history.replaceState(null, '', `${window.location.pathname}${filtrosAUrl(f)}`);
  }, [f, ahora]);

  // Recordar banco, tarjetas (por banco) y ubicación para la próxima visita.
  const { banco, tarjetas, region, comunas, incluirNacionales, soloConMapa } = f;
  useEffect(() => {
    if (!ahora) return;
    const prefs = leerPreferencias();
    guardarPreferencias({
      banco,
      tarjetas: { ...prefs.tarjetas, [banco]: tarjetas },
      ubicacion: { region, comunas, incluirNacionales, soloConMapa },
    });
  }, [ahora, banco, tarjetas, region, comunas, incluirNacionales, soloConMapa]);

  const set = useCallback((cambios: Partial<Filtros>) => setF((prev) => ({ ...prev, ...cambios })), []);

  // Categorías y comercios son propios de cada banco: se limpian al cambiar.
  // Las tarjetas también, pero se recuperan las que el usuario marcó antes en ese banco.
  const cambiarBanco = (nuevo: BancoId) => {
    if (nuevo === f.banco) return;
    set({ banco: nuevo, categorias: [], comercios: [], tarjetas: leerPreferencias().tarjetas[nuevo] ?? [] });
  };

  const bancosDisponibles = useMemo(
    () => (data ? IDS_BANCOS.filter((id) => data.beneficios.some((b) => b.banco === id)) : IDS_BANCOS),
    [data],
  );

  const indice = useMemo(
    () => (data && ahora ? data.beneficios.filter((b) => estaVigente(b, ahora)).map((b) => ({ b, texto: textoBuscable(b) })) : []),
    [data, ahora],
  );

  const fDiferido = useDeferredValue(f);
  const filtrados = useMemo(() => {
    if (!ahora) return [];
    return ordenar(aplicarFiltros(indice, fDiferido, ahora), fDiferido.orden, miUbicacion);
  }, [indice, fDiferido, ahora, miUbicacion]);

  // Conteos por faceta: cada una se calcula con el resto de los filtros aplicados.
  const facetas = useMemo<Facetas>(() => {
    if (!ahora) return { categorias: [], comercios: [], regiones: [], comunas: [], tipos: [], tarjetas: [] };
    const sin = (cambios: Partial<Filtros>) => aplicarFiltros(indice, { ...fDiferido, ...cambios }, ahora);
    const porCategoria = sin({ categorias: [] });
    // Categorías sin resultados se muestran deshabilitadas, pero solo las del banco elegido.
    const todasCategorias = new Set(
      indice.filter(({ b }) => b.banco === fDiferido.banco).flatMap(({ b }) => b.categorias),
    );
    const categorias = contar(porCategoria.flatMap((b) => b.categorias));
    for (const c of todasCategorias) if (!categorias.some(([x]) => x === c)) categorias.push([c, 0]);

    const porUbicacion = sin({ region: '', comunas: [], incluirNacionales: false });
    const enRegion = fDiferido.region ? sin({ comunas: [], incluirNacionales: false }) : [];
    return {
      categorias,
      comercios: contar(sin({ comercios: [] }).map((b) => b.comercio.nombre)),
      regiones: contar(porUbicacion.flatMap((b) => b.regiones)),
      comunas: contar(
        enRegion.flatMap((b) => [
          ...new Set(b.ubicaciones.filter((u) => u.region === fDiferido.region).map((u) => u.comuna)),
        ]),
      ),
      tipos: contar(sin({ tipos: [] }).map((b) => b.tipo)),
      tarjetas: [...new Set(indice.filter(({ b }) => b.banco === fDiferido.banco).flatMap(({ b }) => b.tarjetas))],
    };
  }, [indice, fDiferido, ahora]);

  const verEnMapa = useCallback(
    (b: Beneficio) => {
      setSeleccionado(null);
      if (!pantallaAncha) setVista('mapa');
      setEnfocar((prev) => ({ id: b.id, n: (prev?.n ?? 0) + 1 }));
    },
    [pantallaAncha],
  );

  const pedirUbicacion = () => {
    setErrorUbicacion(null);
    if (!navigator.geolocation) return setErrorUbicacion('Tu navegador no permite obtener la ubicación.');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setMiUbicacion({ lat: p.coords.latitude, lng: p.coords.longitude });
        set({ orden: 'cercania' });
      },
      () => setErrorUbicacion('No se pudo obtener tu ubicación.'),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  const cambiarOrden = (o: Orden) => {
    if (o === 'cercania' && !miUbicacion) return pedirUbicacion();
    set({ orden: o });
  };

  // En el mapa, si se filtró por comuna/región, mostrar solo las sucursales de esa zona.
  const paraMapa = useMemo(() => {
    if (!fDiferido.comunas.length && !fDiferido.region) return filtrados;
    return filtrados.map((b) => ({
      ...b,
      ubicaciones: b.ubicaciones.filter((u) =>
        fDiferido.comunas.length ? fDiferido.comunas.includes(u.comuna) : u.region === fDiferido.region,
      ),
    }));
  }, [filtrados, fDiferido.comunas, fDiferido.region]);

  const activos = contarFiltrosActivos(f);
  const hoy = (ahora?.getDay() ?? 1) as DiaSemana;
  const conPin = filtrados.filter((b) => b.ubicaciones.length).length;
  const mostrarMapa = pantallaAncha || vista === 'mapa';

  const chipsActivos: { etiqueta: string; quitar: () => void }[] = [
    ...(f.q ? [{ etiqueta: `“${f.q}”`, quitar: () => set({ q: '' }) }] : []),
    ...(f.descuentoMin ? [{ etiqueta: `≥ ${f.descuentoMin}%`, quitar: () => set({ descuentoMin: 0 }) }] : []),
    ...f.dias.map((d) => ({ etiqueta: DIAS_CORTOS[d], quitar: () => set({ dias: f.dias.filter((x) => x !== d) }) })),
    ...(f.region ? [{ etiqueta: f.region, quitar: () => set({ region: '', comunas: [] }) }] : []),
    ...f.comunas.map((c) => ({ etiqueta: c, quitar: () => set({ comunas: f.comunas.filter((x) => x !== c) }) })),
    ...f.categorias.map((c) => ({ etiqueta: c, quitar: () => set({ categorias: f.categorias.filter((x) => x !== c) }) })),
    ...f.tarjetas.map((t) => ({ etiqueta: t, quitar: () => set({ tarjetas: f.tarjetas.filter((x) => x !== t) }) })),
    ...f.tipos.map((t) => ({ etiqueta: ETIQUETA_TIPO[t], quitar: () => set({ tipos: f.tipos.filter((x) => x !== t) }) })),
    ...(f.canal ? [{ etiqueta: f.canal === 'online' ? 'Online' : 'Presencial', quitar: () => set({ canal: '' }) }] : []),
    ...(f.soloConMapa ? [{ etiqueta: 'Con ubicación', quitar: () => set({ soloConMapa: false }) }] : []),
    ...f.comercios.map((c) => ({ etiqueta: c, quitar: () => set({ comercios: f.comercios.filter((x) => x !== c) }) })),
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Encabezado */}
      <header className="sticky top-0 z-[1100] border-b border-line bg-surface/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-6">
          <div className="mr-auto flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight">Beneficios</h1>
            {/* Invisible hasta montar: evita mostrar el banco por defecto antes de leer el guardado. */}
            <label className={`relative ${ahora ? '' : 'invisible'}`}>
              <span className="sr-only">Banco</span>
              <span
                className="pointer-events-none absolute left-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
                style={{ background: BANCOS[f.banco].color }}
                aria-hidden
              />
              <select
                value={f.banco}
                onChange={(e) => cambiarBanco(e.target.value as BancoId)}
                className="rounded-full bg-surface-2 py-2 pl-7 pr-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {bancosDisponibles.map((id) => (
                  <option key={id} value={id}>
                    {BANCOS[id].nombre}
                  </option>
                ))}
              </select>
            </label>
            <span className="hidden text-xs text-muted sm:inline">visor no oficial</span>
          </div>

          <div className="order-last flex w-full items-center gap-2 md:order-none md:w-auto md:flex-1 md:max-w-xl">
            <label className="relative flex-1">
              <span className="sr-only">Buscar</span>
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={f.q}
                onChange={(e) => set({ q: e.target.value })}
                placeholder="Buscar comercio, comida, comuna…"
                className="w-full rounded-full bg-surface-2 py-2 pl-9 pr-4 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            <button
              type="button"
              onClick={() => setPanelAbierto(true)}
              className="relative rounded-full bg-surface-2 px-4 py-2 text-sm font-medium lg:hidden"
            >
              Filtros
              {activos > 0 && (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-xs text-accent-ink">
                  {activos}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="orden">
              Ordenar
            </label>
            <select
              id="orden"
              value={f.orden === 'cercania' && !miUbicacion ? 'descuento' : f.orden}
              onChange={(e) => cambiarOrden(e.target.value as Orden)}
              className="rounded-full bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {ORDENES.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
            {!pantallaAncha && (
              <div className="flex rounded-full bg-surface-2 p-1 text-sm">
                {(['lista', 'mapa'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVista(v)}
                    className={`rounded-full px-3 py-1 font-medium capitalize ${vista === v ? 'bg-surface shadow' : 'text-muted'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Filtros: barra lateral en escritorio, cajón en móvil */}
        <aside className="sticky top-[65px] hidden h-[calc(100dvh-65px)] w-80 shrink-0 overflow-y-auto border-r border-line bg-surface px-5 pb-6 lg:block">
          <PanelFiltros f={f} set={set} facetas={facetas} hoy={hoy} />
        </aside>
        {panelAbierto && (
          <div className="fixed inset-0 z-[1200] lg:hidden" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/50" onClick={() => setPanelAbierto(false)} />
            <div className="absolute inset-y-0 left-0 flex w-[min(22rem,90vw)] flex-col bg-surface shadow-2xl">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <h2 className="font-semibold">Filtros</h2>
                <button type="button" onClick={() => setPanelAbierto(false)} className="text-2xl leading-none text-muted" aria-label="Cerrar filtros">
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-4">
                <PanelFiltros f={f} set={set} facetas={facetas} hoy={hoy} />
              </div>
              <div className="border-t border-line p-3">
                <button
                  type="button"
                  onClick={() => setPanelAbierto(false)}
                  className="w-full rounded-full bg-accent py-2.5 font-semibold text-accent-ink"
                >
                  Ver {filtrados.length} beneficios
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lista */}
        {(pantallaAncha || vista === 'lista') && (
          <main className="min-w-0 flex-1 px-4 py-4 lg:px-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <p className="mr-2 text-sm">
                <strong className="text-base">{filtrados.length}</strong>{' '}
                <span className="text-muted">
                  beneficios vigentes · {conPin} en el mapa
                  {data && ` · datos del ${formatoFecha(data.generadoEn)}`}
                </span>
              </p>
              {chipsActivos.map((c, i) => (
                <button
                  key={`${c.etiqueta}-${i}`}
                  type="button"
                  onClick={c.quitar}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent hover:opacity-80"
                >
                  {c.etiqueta} <span aria-hidden>×</span>
                </button>
              ))}
              {errorUbicacion && <p className="text-xs text-hot">{errorUbicacion}</p>}
            </div>

            {error && (
              <p className="rounded-xl bg-hot-soft p-4 text-sm text-hot">No se pudieron cargar los beneficios ({error}).</p>
            )}
            {!data && !error && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} className="h-72 animate-pulse rounded-2xl bg-surface-2" />
                ))}
              </div>
            )}
            {data && ahora && filtrados.length === 0 && (
              <div className="rounded-2xl bg-surface p-10 text-center ring-1 ring-line">
                <p className="font-semibold">Ningún beneficio coincide con estos filtros.</p>
                <button
                  type="button"
                  onClick={() => set(filtrosLimpios(f))}
                  className="mt-3 text-sm font-medium text-accent hover:underline"
                >
                  Limpiar filtros
                </button>
              </div>
            )}
            {ahora && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
                {filtrados.map((b) => (
                  <TarjetaBeneficio
                    key={b.id}
                    b={b}
                    ahora={ahora}
                    activo={activoId === b.id}
                    distanciaKm={miUbicacion && b.ubicaciones.length ? distanciaMinima(b, miUbicacion) : undefined}
                    onAbrir={setSeleccionado}
                    onHover={setActivoId}
                    onVerEnMapa={verEnMapa}
                  />
                ))}
              </div>
            )}

            <footer className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-muted">
              Proyecto personal y <strong>no oficial</strong>, sin relación con ningún banco. Los datos se obtienen
              periódicamente de la información pública de beneficios de{' '}
              {Object.values(BANCOS).map((b, i, a) => (
                <span key={b.nombre}>
                  <a className="underline" href={b.sitio} target="_blank" rel="noreferrer">
                    {b.nombre}
                  </a>
                  {i < a.length - 2 ? ', ' : i === a.length - 2 ? ' y ' : ''}
                </span>
              ))}{' '}
              y pueden estar desactualizados; confirma siempre las condiciones en los canales oficiales.
              {data?.bancos.some((b) => b.error) && (
                <> Última actualización con problemas en: {data.bancos.filter((b) => b.error).map((b) => b.nombre).join(', ')}.</>
              )}{' '}
              Las ubicaciones se estiman con{' '}
              <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap
              </a>{' '}
              y pueden ser aproximadas.
            </footer>
          </main>
        )}

        {/* Mapa */}
        {mostrarMapa && (
          <section
            className={
              pantallaAncha
                ? 'sticky top-[65px] h-[calc(100dvh-65px)] w-[40%] shrink-0 border-l border-line'
                : 'h-[calc(100dvh-150px)] w-full md:h-[calc(100dvh-65px)]'
            }
          >
            <Mapa
              beneficios={paraMapa}
              activoId={activoId}
              enfocar={enfocar}
              onSeleccionar={setSeleccionado}
              miUbicacion={miUbicacion}
            />
          </section>
        )}
      </div>

      {ahora && (
        <DetalleBeneficio b={seleccionado} ahora={ahora} onCerrar={() => setSeleccionado(null)} onVerEnMapa={verEnMapa} />
      )}
    </div>
  );
}
