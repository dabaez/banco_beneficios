'use client';

import { useMemo, useState } from 'react';
import { filtrosLimpios, normalizar, tarjetasDe, type Filtros } from '@/lib/filtros';
import { DIAS_CORTOS, ETIQUETA_TIPO, ORDEN_DIAS } from '@/lib/formato';
import { BANCOS, type DiaSemana, type TipoBeneficio } from '@/lib/tipos';

export interface Facetas {
  categorias: [string, number][];
  comercios: [string, number][];
  regiones: [string, number][];
  comunas: [string, number][];
  tipos: [TipoBeneficio, number][];
  /** Tarjetas que aparecen en alguna oferta vigente del banco: las demás no filtran nada. */
  tarjetas: string[];
}

interface Props {
  f: Filtros;
  set: (cambios: Partial<Filtros>) => void;
  facetas: Facetas;
  hoy: DiaSemana;
}

function alternar<T>(lista: T[], v: T): T[] {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
}

function Chip({
  activo,
  onClick,
  children,
  n,
  disabled,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  n?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      disabled={disabled && !activo}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm ring-1 transition disabled:opacity-40 ${
        activo ? 'bg-accent text-accent-ink ring-accent' : 'bg-surface text-ink ring-line hover:ring-accent'
      }`}
    >
      {children}
      {n != null && <span className={`text-xs ${activo ? 'opacity-80' : 'text-muted'}`}>{n}</span>}
    </button>
  );
}

function Seccion({ titulo, children, accion }: { titulo: string; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <section className="border-b border-line py-4 last:border-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{titulo}</h3>
        {accion}
      </div>
      {children}
    </section>
  );
}

const MINIMOS = [0, 15, 20, 30, 40, 50];

export default function PanelFiltros({ f, set, facetas, hoy }: Props) {
  const [verTodasCategorias, setVerTodasCategorias] = useState(false);
  const [busquedaComercio, setBusquedaComercio] = useState('');

  const comerciosVisibles = useMemo(() => {
    const q = normalizar(busquedaComercio.trim());
    const lista = q ? facetas.comercios.filter(([c]) => normalizar(c).includes(q)) : facetas.comercios;
    const seleccionados = f.comercios.filter((c) => !lista.some(([x]) => x === c)).map((c) => [c, 0] as [string, number]);
    return [...seleccionados, ...lista].slice(0, q ? 50 : 12);
  }, [busquedaComercio, facetas.comercios, f.comercios]);

  const categorias = verTodasCategorias ? facetas.categorias : facetas.categorias.slice(0, 10);

  return (
    <div className="text-sm">
      <Seccion titulo="Descuento mínimo">
        <div className="flex flex-wrap gap-1.5">
          {MINIMOS.map((m) => (
            <Chip key={m} activo={f.descuentoMin === m} onClick={() => set({ descuentoMin: m })}>
              {m === 0 ? 'Cualquiera' : `≥ ${m}%`}
            </Chip>
          ))}
        </div>
      </Seccion>

      <Seccion
        titulo="Día"
        accion={
          <button
            type="button"
            className="text-xs font-medium text-accent hover:underline"
            onClick={() => set({ dias: f.dias.length === 1 && f.dias[0] === hoy ? [] : [hoy] })}
          >
            {f.dias.length === 1 && f.dias[0] === hoy ? 'Quitar' : 'Solo hoy'}
          </button>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {ORDEN_DIAS.map((d) => (
            <Chip key={d} activo={f.dias.includes(d)} onClick={() => set({ dias: alternar(f.dias, d) })}>
              {DIAS_CORTOS[d]}
              {d === hoy && <span className="text-[10px]">•</span>}
            </Chip>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">Incluye los beneficios válidos todos los días.</p>
      </Seccion>

      <Seccion titulo="Ubicación">
        <select
          value={f.region}
          onChange={(e) => set({ region: e.target.value, comunas: [] })}
          className="w-full rounded-lg bg-surface px-3 py-2 ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">Todas las regiones</option>
          {facetas.regiones.map(([r, n]) => (
            <option key={r} value={r}>
              {r} ({n})
            </option>
          ))}
        </select>
        {facetas.comunas.length > 0 && (
          <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {facetas.comunas.map(([c, n]) => (
              <Chip key={c} activo={f.comunas.includes(c)} n={n} onClick={() => set({ comunas: alternar(f.comunas, c) })}>
                {c}
              </Chip>
            ))}
          </div>
        )}
        {(f.region || f.comunas.length > 0) && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.incluirNacionales}
              onChange={(e) => set({ incluirNacionales: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            Incluir válidos en todo Chile y online
          </label>
        )}
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.soloConMapa}
            onChange={(e) => set({ soloConMapa: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          Solo con ubicación en el mapa
        </label>
      </Seccion>

      <Seccion titulo="Categoría">
        <div className="flex flex-wrap gap-1.5">
          {categorias.map(([c, n]) => (
            <Chip
              key={c}
              activo={f.categorias.includes(c)}
              n={n}
              disabled={n === 0}
              onClick={() => set({ categorias: alternar(f.categorias, c) })}
            >
              {c}
            </Chip>
          ))}
        </div>
        {facetas.categorias.length > 10 && (
          <button
            type="button"
            className="mt-2 text-xs font-medium text-accent hover:underline"
            onClick={() => setVerTodasCategorias((v) => !v)}
          >
            {verTodasCategorias ? 'Ver menos' : `Ver todas (${facetas.categorias.length})`}
          </button>
        )}
      </Seccion>

      <Seccion titulo={`Mis tarjetas ${BANCOS[f.banco].nombre}`}>
        <div className="flex flex-wrap gap-1.5">
          {tarjetasDe(f.banco)
            .filter((t) => facetas.tarjetas.includes(t) || f.tarjetas.includes(t))
            .map((t) => (
              <Chip key={t} activo={f.tarjetas.includes(t)} onClick={() => set({ tarjetas: alternar(f.tarjetas, t) })}>
                {t}
              </Chip>
            ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          Marca las que tienes: se ocultan los beneficios exclusivos de otras tarjetas.
        </p>
      </Seccion>

      <Seccion titulo="Tipo y canal">
        <div className="flex flex-wrap gap-1.5">
          {facetas.tipos.map(([t, n]) => (
            <Chip key={t} activo={f.tipos.includes(t)} n={n} onClick={() => set({ tipos: alternar(f.tipos, t) })}>
              {ETIQUETA_TIPO[t]}
            </Chip>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['', 'presencial', 'online'] as const).map((c) => (
            <Chip key={c || 'todos'} activo={f.canal === c} onClick={() => set({ canal: c })}>
              {c === '' ? 'Presencial y online' : c === 'presencial' ? 'Presencial' : 'Online'}
            </Chip>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Comercio">
        <input
          type="search"
          value={busquedaComercio}
          onChange={(e) => setBusquedaComercio(e.target.value)}
          placeholder={`Buscar entre ${facetas.comercios.length} comercios…`}
          className="w-full rounded-lg bg-surface px-3 py-2 ring-1 ring-line placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <ul className="mt-2 space-y-0.5">
          {comerciosVisibles.map(([c, n]) => (
            <li key={c}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={f.comercios.includes(c)}
                  onChange={() => set({ comercios: alternar(f.comercios, c) })}
                  className="accent-[var(--accent)]"
                />
                <span className="flex-1 truncate">{c}</span>
                {n > 0 && <span className="text-xs text-muted">{n}</span>}
              </label>
            </li>
          ))}
        </ul>
      </Seccion>

      <button
        type="button"
        onClick={() => {
          set(filtrosLimpios(f));
          setBusquedaComercio('');
        }}
        className="mt-2 w-full rounded-lg py-2 text-sm font-medium text-muted ring-1 ring-line hover:text-ink"
      >
        Limpiar todos los filtros
      </button>
    </div>
  );
}
