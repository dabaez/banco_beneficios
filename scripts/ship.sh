#!/usr/bin/env bash
#
# ship.sh — compila el visor y lo publica en el droplet.
#
# Lo corre deploy.yml, y también se puede correr desde tu máquina, así que
# una caída de GitHub nunca bloquea un deploy:
#
#   DEPLOY_TARGET=banco-deploy scripts/ship.sh              # compilar y subir
#   DEPLOY_TARGET=banco-deploy scripts/ship.sh scrape       # re-scrapear ahora (no espera)
#   DEPLOY_TARGET=banco-deploy scripts/ship.sh rollback     # vuelve la release anterior
#   DEPLOY_TARGET=banco-deploy scripts/ship.sh activate <release-id>
#   DEPLOY_TARGET=banco-deploy scripts/ship.sh releases     # lista releases, * = publicada
#
# DEPLOY_TARGET es cualquier cosa que acepte ssh: banco-beneficios@<droplet>,
# o un Host de ~/.ssh/config con el usuario y la llave de deploy. En el
# droplet la llave solo puede correr receive-site (dabaez/droplet-infra).
#
# El sitio carga beneficios.json al abrirse, así que se compila sin datos y
# el scraping no es parte del deploy: corre aparte en el droplet
# (deploy/scrape, con su timer). Cada release sube:
#
#   public/   web/out, con beneficios.json como link a los datos que publica
#             el scraper (~/published, fuera de las releases)
#   app/      el repo, para que el timer corra el scraper y receive-site
#             instale deploy/systemd/
#
# BASE_PATH (opcional): si el sitio se sirve bajo un subdirectorio.
#
set -euo pipefail

TARGET="${DEPLOY_TARGET:?falta DEPLOY_TARGET, ej. banco-beneficios@<droplet> o un Host de ssh}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

remote() {
  ssh -o BatchMode=yes "$TARGET" "$@"
}

case "${1:-}" in
  "") ;;
  scrape)
    remote start banco-beneficios-scrape.service
    exit
    ;;
  rollback | releases)
    remote "$1"
    exit
    ;;
  activate)
    remote activate "${2:?uso: ship.sh activate <release-id>}"
    exit
    ;;
  *)
    echo "uso: ship.sh [scrape | rollback | releases | activate <release-id>]" >&2
    exit 1
    ;;
esac

# Una release es un commit: no publicar nada sin commitear.
if [ -n "$(git status --porcelain)" ]; then
  echo "hay cambios sin commitear; commitéalos o guárdalos antes de publicar:" >&2
  git status --short >&2
  exit 1
fi

STAGE="$(mktemp -d)"
placeholder=0
cleanup() {
  rm -rf "$STAGE"
  if [ "$placeholder" = 1 ]; then rm -f data/beneficios.json; fi
}
trap cleanup EXIT

# El build solo necesita que exista un beneficios.json (web/scripts/copiar-datos.mjs);
# en la release se reemplaza por el link a los datos del droplet.
if [ ! -f data/beneficios.json ]; then
  mkdir -p data
  echo '{"generadoEn":"1970-01-01T00:00:00Z","bancos":[],"total":0,"beneficios":[]}' > data/beneficios.json
  placeholder=1
fi

(cd web && pnpm install --frozen-lockfile && pnpm build)

cp -r web/out "$STAGE/public"
rm -f "$STAGE/public/beneficios.json"
# releases/<id>/public/ → ../../../ es el home del usuario del sitio
ln -s ../../../published/beneficios.json "$STAGE/public/beneficios.json"
git archive --prefix=app/ HEAD | tar -x -C "$STAGE"

id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=12 HEAD)"
echo "--- subiendo $id a $TARGET"
tar -czf - -C "$STAGE" public app | remote deploy "$id"
