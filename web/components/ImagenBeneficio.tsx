'use client';

import { useState, type ImgHTMLAttributes } from 'react';

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  /** Copia reducida que publica el scraper (ej. "img/3fa9…-i.webp"), relativa a la raíz del sitio. */
  optimizada?: string | null;
  /** URL original, en el sitio del banco. */
  original: string;
}

/** Imagen de un beneficio: la copia reducida si hay, y la original si esa no carga. */
export default function ImagenBeneficio({ optimizada, original, alt = '', ...resto }: Props) {
  // Se guarda cuál falló (no un booleano) para que al cambiar de beneficio se vuelva a intentar.
  const [fallida, setFallida] = useState<string | null>(null);
  const usarCopia = !!optimizada && optimizada !== fallida;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...resto}
      alt={alt}
      src={usarCopia ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${optimizada}` : original}
      onError={usarCopia ? () => setFallida(optimizada) : undefined}
    />
  );
}
