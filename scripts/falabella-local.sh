#!/usr/bin/env bash
#
# falabella-local.sh — scrapea Banco Falabella desde esta máquina y lo publica
# en el droplet.
#
# Cloudflare le responde 403 al droplet (IP de datacenter), incluso con
# navegador, pero no a una IP residencial. Este script:
#
#   1. baja ~/data del droplet (beneficios.json, geocache.json, img/) a data/
#   2. corre `node scraper --banco falabella` aquí; los demás bancos quedan
#      tal como los dejó el droplet
#   3. sube data/ de vuelta y lo publica con deploy/publicar
#
#   scripts/falabella-local.sh
#
# Reemplaza el data/ local por los datos del droplet. Necesita ssh como root
# al droplet: DROPLET (por defecto el Host "do" de ~/.ssh/config). El scraper
# del droplet, cuando Falabella le falla, conserva lo que suba este script.
#
set -euo pipefail

DROPLET="${DROPLET:-do}"
SITIO="${SITIO:-bancob}"
REMOTO="/srv/sites/$SITIO/data"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

remote() {
  ssh -o BatchMode=yes "$DROPLET" "$@"
}

# Que una corrida del droplet a medias no pise lo que subimos (ni al revés).
if remote "pgrep -u $SITIO -f 'node scraper' >/dev/null"; then
  echo "el droplet está scrapeando ahora; vuelve a intentarlo cuando termine" >&2
  exit 1
fi

echo "--- bajando datos del droplet"
mkdir -p data/img
rsync -a "$DROPLET:$REMOTO/beneficios.json" "$DROPLET:$REMOTO/geocache.json" data/
# Las imágenes se llaman por el hash de su URL y nunca se reescriben: basta
# con traer las que faltan.
rsync -a --ignore-existing "$DROPLET:$REMOTO/img/" data/img/

# Con un solo banco, 3 significa que falló Falabella: entonces no se sube nada.
status=0
node scraper --banco falabella || status=$?
if [ "$status" -ne 0 ]; then
  echo "✖ el scraper salió con $status; no se sube nada" >&2
  exit "$status"
fi

echo "--- subiendo y publicando"
rsync -a --chown="$SITIO:$SITIO" data/beneficios.json data/geocache.json "$DROPLET:$REMOTO/"
# --delete: el scraper ya borró de data/img las que no se usan.
rsync -a --ignore-existing --delete --chown="$SITIO:$SITIO" data/img/ "$DROPLET:$REMOTO/img/"
remote "sudo -H -u $SITIO bash -s" < deploy/publicar
