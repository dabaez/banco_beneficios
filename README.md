# Visor de beneficios Bci (no oficial)

Sitio personal que presenta los beneficios públicos de BCI Plus con filtros combinables,
orden por descuento y un mapa con pines. **No es un servicio oficial ni está afiliado a Banco Bci.**

```
shared/beneficio.ts   tipos compartidos (respuesta cruda de la API + dataset enriquecido)
scraper/              ingesta + geocodificación (Node 22, TypeScript sin build ni dependencias)
data/                 beneficios.json y geocache.json — generados, NO versionados
web/                  Next.js (App Router, export estático) + Tailwind + react-leaflet
scripts/deploy.sh     build y publicación del sitio (modos full / datos)
```

## Datos

```bash
node scraper                     # API de BCI + geocodifica solo lo que no está en caché
node scraper --sin-geocodificar  # no llama a Nominatim; usa solo data/geocache.json
```

Requiere Node ≥ 22.18, que ejecuta TypeScript de forma nativa.
Para el typecheck: `pnpm install && pnpm typecheck` en la raíz.

- **Fuente:** `GET https://api.bciplus.cl/bff-loyalty-beneficios/v1/offers?itemsPorPagina=100&pagina=N`
  con el header `Ocp-Apim-Subscription-Key`. Responde `{ paginado, ofertas[] }`.
- **Si responde 401/403**, rotaron la key: sácala de las DevTools de bci.cl (pestaña Network,
  request a `.../offers`) y pásala en `BCI_SUBSCRIPTION_KEY`, o actualiza el valor por defecto
  en `scraper/api.ts`.
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

## Deploy

El sitio es estático: `scripts/deploy.sh` compila y copia `web/out` al directorio que sirve el
servidor web. Tiene dos modos (ver los comentarios del script):

- `full` — instala, compila y publica todo. Es lo que ejecuta el workflow de GitHub Actions al
  pushear a `main` (necesita los secrets `HOST` y `SSH_PRIVATE_KEY`).
- `datos` — re-scrapea BCI y reemplaza solo `beneficios.json` en el sitio publicado, sin
  recompilar. Pensado para correr por cron:

  ```cron
  0 6 1 * * /ruta/al/repo/scripts/deploy.sh datos >> /var/log/bci-beneficios.log 2>&1
  ```

`data/` vive solo en el servidor. Si el scraper falla (por ejemplo, un 401 porque rotaron la
key), el sitio sigue sirviendo los datos anteriores y el error queda en el log.

Variables opcionales, en un `.env` en la raíz del repo: `BCI_SUBSCRIPTION_KEY`,
`NOMINATIM_USER_AGENT`, `NOMINATIM_EMAIL`, `WWW_DIR` (destino de la publicación) y `BASE_PATH`
(si el sitio se sirve bajo un subdirectorio).

Nota: la mayoría de las ofertas vence en menos de un mes, así que un cron mensual deja pocas
vigentes al final del ciclo. Semanal (`0 6 * * 1`) cuesta lo mismo: ~4 requests a BCI por corrida.

## Extensión futura: Google Places (opcional, de pago)

No incluida. Si se agrega, conviene un `scraper/places.ts` separado, activado solo si existe
`GOOGLE_PLACES_API_KEY`, con su propio caché (`data/placescache.json`). Debería correr después
de la geocodificación, solo sobre ubicaciones con `precision: 'local'`, y agregar campos
opcionales (`rating`, `fotos`, `horario`) a `Ubicacion`.
