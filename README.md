# Visor de beneficios Bci (no oficial)

Sitio personal que presenta los beneficios públicos de BCI Plus con filtros combinables,
orden por descuento y un mapa con pines. **No es un servicio oficial ni está afiliado a Banco Bci.**

```
shared/beneficio.ts          tipos compartidos (respuesta cruda de la API + dataset enriquecido)
scraper/                     ingesta + geocodificación (Node 22, TypeScript sin build ni dependencias)
data/                        beneficios.json y geocache.json — generados, NO versionados
web/                         Next.js (App Router, export estático) + Tailwind + react-leaflet
scripts/deploy.sh            build y publicación en el droplet (modos full / datos)
.github/workflows/deploy.yml push a main → SSH al droplet → deploy.sh full
```

## Datos

```bash
node scraper                     # API de BCI + geocodifica solo lo que no está en caché
node scraper --sin-geocodificar  # no llama a Nominatim; usa solo data/geocache.json
```

Requiere Node ≥ 22.18, que ejecuta TypeScript de forma nativa. Para el typecheck: `pnpm install && pnpm typecheck` en la raíz.

- **Fuente:** `GET https://api.bciplus.cl/bff-loyalty-beneficios/v1/offers?itemsPorPagina=100&pagina=N`
  con el header `Ocp-Apim-Subscription-Key`. Responde `{ paginado, ofertas[] }`.
- **Si responde 401/403**, rotaron la key: sácala de las DevTools de bci.cl (pestaña Network, request a
  `.../offers`) y pásala como `BCI_SUBSCRIPTION_KEY` (en el droplet, en `.env`),
  o actualiza el valor por defecto en `scraper/api.ts`.
- **Ubicaciones:** la API **no entrega direcciones**. La comuna o el sector se detectan en tags,
  `keywords` y títulos (`scraper/localidades.ts`). Luego se busca el local en Nominatim y se usa
  lo que se encuentre primero:
  1. `local`: el local está en OpenStreetMap, dentro de la comuna.
  2. `sector`: centro de un sector conocido (Mall Sport, Barrio Italia, Reñaca…).
  3. `comuna`: centro de la comuna.

  En el mapa, los pines aproximados (2 y 3) tienen borde punteado.
  Nominatim se usa respetando su política: 1 request/s, User-Agent identificable
  (`NOMINATIM_USER_AGENT`, `NOMINATIM_EMAIL`) y caché en disco. Los resultados con datos
  duran 1 año en caché y las búsquedas vacías, 90 días.
- Los beneficios online o "todo Chile" no tienen pin, pero se pueden filtrar.

## Frontend

```bash
node scraper     # la primera vez, para tener data/beneficios.json
cd web
pnpm install
pnpm dev         # copia ../data/beneficios.json a public/ y levanta http://localhost:3000
pnpm build       # export estático en web/out
```

Todo el filtrado y el orden ocurren en el cliente (`web/lib/filtros.ts`). Los filtros quedan
en la URL, así que una búsqueda se puede compartir. Los beneficios vencidos se ocultan según la
fecha del navegador. La página carga `beneficios.json` al abrirse, así que actualizar los datos
no requiere recompilar.

## Deploy (droplet de DigitalOcean)

El mismo esquema que el blog y tteatro. Un push a `main` entra por SSH y ejecuta
`scripts/deploy.sh full`: hace pull, instala desde cero, compila y copia `web/out` a
`/var/www/bci-beneficios`. El cron ejecuta `scripts/deploy.sh datos`: re-scrapea BCI y
reemplaza solo `beneficios.json` en el sitio publicado. Ambos modos usan `flock` y limpian los
artefactos de build.

`data/` vive solo en el servidor. Si el scraper falla (por ejemplo, un 401 porque rotaron la
key), el sitio sigue sirviendo los datos anteriores y el error queda en el log.

### Setup inicial (una vez)

Requiere Node ≥ 22.18 y pnpm en el droplet.

```bash
cd ~ && git clone git@github.com:dabaez/bci_beneficios.git
# Opcional: evita las ~400 consultas iniciales a Nominatim (~7 min) copiando el caché local
#   scp data/geocache.json root@<droplet>:bci_beneficios/data/
cd bci_beneficios && ./scripts/deploy.sh full
```

`.env` opcional en la raíz del repo del droplet (lo lee `deploy.sh`):

```bash
BCI_SUBSCRIPTION_KEY=...        # solo si la key del código deja de funcionar
NOMINATIM_USER_AGENT="bci-beneficios-visor/1.0 (contacto: tu@email)"
BASE_PATH=/beneficios           # solo si se sirve bajo un subdirectorio
WWW_DIR=/var/www/bci-beneficios
```

nginx (sitio estático, ejemplo):

```nginx
server {
  server_name beneficios.tudominio.cl;
  root /var/www/bci-beneficios;

  location / {
    try_files $uri $uri.html $uri/ =404;
  }
  location /_next/static/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
  location = /beneficios.json {
    add_header Cache-Control "no-cache";   # revalida: el cron lo reemplaza
  }
}
```

Crontab del droplet (`crontab -e`), día 1 de cada mes a las 06:00:

```cron
0 6 1 * * /root/bci_beneficios/scripts/deploy.sh datos >> /var/log/bci-beneficios.log 2>&1
```

Ojo: la mayoría de las ofertas vence en menos de un mes. Si al final de mes quedan pocas,
conviene pasarlo a semanal (`0 6 * * 1`); cada corrida hace solo ~4 requests a BCI.

GitHub Actions necesita los secrets `HOST` y `SSH_PRIVATE_KEY`, igual que los otros repos.

## Extensión futura: Google Places (opcional, de pago)

No incluida. Si se agrega, conviene un `scraper/places.ts` separado, activado solo si existe
`GOOGLE_PLACES_API_KEY`, con su propio caché (`data/placescache.json`). Debería correr después
de la geocodificación, solo sobre ubicaciones con `precision: 'local'`, y agregar campos
opcionales (`rating`, `fotos`, `horario`) a `Ubicacion`.
