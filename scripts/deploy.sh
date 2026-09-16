#!/usr/bin/env bash
#
# deploy.sh — publica el visor en $WWW_DIR desde el droplet.
#
#   ./scripts/deploy.sh          # full: git pull + instalación limpia + build + publicar
#   ./scripts/deploy.sh datos    # cron: re-scrapea BCI y reemplaza solo beneficios.json
#
# El sitio es un export estático de Next.js que carga beneficios.json al abrirse,
# así que actualizar los datos no requiere recompilar: el modo `datos` solo
# corre el scraper y copia el JSON nuevo sobre el publicado.
#
# data/beneficios.json y data/geocache.json no se versionan: viven en el servidor.
# Si el scraper falla (ej. 401 porque rotaron la key), el sitio publicado queda
# intacto con los datos anteriores.
#
# Ambos modos toman un lock exclusivo para que un cron y un deploy nunca se crucen.
#
set -euo pipefail

# cron corre con un PATH mínimo: asegurar que node/pnpm estén disponibles.
export PATH="$PATH:/usr/local/bin:/usr/bin:$HOME/.local/share/pnpm:$HOME/.nvm/versions/node/current/bin"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WWW_DIR="${WWW_DIR:-/var/www/bci-beneficios}"
MODE="${1:-full}"

cd "$REPO_DIR"

exec 9>"$REPO_DIR/.deploy.lock"
flock 9

echo "=== $(date -Is) deploy.sh ($MODE) ==="

# Variables opcionales del servidor (BCI_SUBSCRIPTION_KEY, NOMINATIM_USER_AGENT,
# NOMINATIM_EMAIL, BASE_PATH, WWW_DIR).
if [ -f "$REPO_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_DIR/.env"
  set +a
fi

# El scraper usa type stripping nativo de Node (sin build ni dependencias).
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  echo "✖ Se necesita Node >= 22.18 (hay $(node --version))." >&2
  exit 1
fi

# Se ejecuta con éxito o error: nunca dejar artefactos de build en el droplet.
cleanup() {
  local status=$?
  echo "--- cleanup"
  rm -rf "$REPO_DIR/web/.next" "$REPO_DIR/web/out"
  # borrar paquetes del store global que ya nadie referencia
  pnpm store prune >/dev/null 2>&1 || true
  df -h "$REPO_DIR" | tail -n 1
  echo "=== $(date -Is) exit $status ==="
}
trap cleanup EXIT

publicar_datos() {
  mkdir -p "$WWW_DIR"
  # copia + mv: nginx nunca sirve un JSON a medio escribir
  cp data/beneficios.json "$WWW_DIR/.beneficios.json.tmp"
  mv "$WWW_DIR/.beneficios.json.tmp" "$WWW_DIR/beneficios.json"
}

case "$MODE" in
  full)
    git pull
    # desde cero para que un lockfile actualizado no deje paquetes viejos
    rm -rf web/node_modules web/.next web/out
    (cd web && pnpm install --frozen-lockfile)

    # Primer deploy (o datos borrados): generar los datos antes del build.
    if [ ! -f data/beneficios.json ]; then
      echo "--- data/beneficios.json no existe: ejecutando scraper"
      node scraper
    fi

    (cd web && pnpm build)

    mkdir -p "$WWW_DIR"
    rm -rf "${WWW_DIR:?}"/*
    cp -r web/out/. "$WWW_DIR"/
    ;;

  datos)
    node scraper
    publicar_datos
    ;;

  *)
    echo "Uso: $0 [full|datos]" >&2
    exit 1
    ;;
esac

echo "--- publicado en $WWW_DIR"
