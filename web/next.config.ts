import path from "node:path";
import type { NextConfig } from "next";

// Opcional: si el sitio se sirve bajo un subdirectorio (ej. BASE_PATH=/beneficios).
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  // Sitio 100% estático (web/out), servido por nginx en el droplet.
  output: "export",
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // El repo tiene /shared y /data fuera de /web: la raíz del workspace es el repo.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
