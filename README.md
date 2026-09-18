# Visor de beneficios bancarios (no oficial)

Sitio personal que presenta los beneficios públicos de tarjetas de bancos chilenos (hoy Bci,
Santander, BancoEstado, Banco Falabella y Banco de Chile) con filtros combinables, orden por descuento y un mapa con pines.
**No es un servicio oficial ni está afiliado a ningún banco.**

```
shared/beneficio.ts   forma normalizada común a todos los bancos (data/beneficios.json)
shared/bancos.ts      registro de bancos: nombre, sitio, tarjetas, color
scraper/              ingesta + geocodificación (Node 22, TypeScript sin build)
  bancos/<id>/        un adaptador por banco: api.ts (obtener), transformar.ts (normalizar), tipos.ts (crudo)
data/                 beneficios.json y geocache.json — generados, NO versionados
web/                  Next.js (App Router, export estático) + Tailwind + react-leaflet
scripts/deploy.sh     build y publicación del sitio (modos full / datos)
```

## Datos

```bash
pnpm install && pnpm exec playwright install chromium   # la primera vez (Playwright: Santander y BancoEstado)
node scraper                     # todos los bancos + geocodifica solo lo que no está en caché
node scraper --banco bci         # solo un banco (se puede repetir); los demás conservan sus datos
node scraper --sin-geocodificar  # no llama a Nominatim; usa solo data/geocache.json
```

Requiere Node ≥ 22.18, que ejecuta TypeScript de forma nativa. Typecheck: `pnpm typecheck`.

Si un banco falla, el scraper guarda los demás, conserva los beneficios anteriores del banco
caído (queda marcado con `error` en `bancos[]` del JSON) y sale con código 3.

### Bci

- **Fuente:** `GET https://api.bciplus.cl/bff-loyalty-beneficios/v1/offers?itemsPorPagina=100&pagina=N`
  con el header `Ocp-Apim-Subscription-Key`. Responde `{ paginado, ofertas[] }`. Basta `fetch`.
- **Si responde 401/403**, rotaron la key: sácala de las DevTools de bci.cl (pestaña Network,
  request a `.../offers`) y pásala en `BCI_SUBSCRIPTION_KEY`, o actualiza el valor por defecto
  en `scraper/bancos/bci/api.ts`.

### Santander

- **Fuente:** `GET https://banco.santander.cl/beneficios/promociones.json?per_page=9999&tags=home-disfrutadores&custom_fields=true`
  → `{ promociones[], meta }`, todo en una página (~308).
- **Requiere navegador con ventana.** El dominio está detrás de Akamai Bot Manager: `fetch`,
  curl e incluso Chromium headless reciben 403. El adaptador abre la página con Playwright
  (headed) y pide el JSON desde ella. En un servidor sin pantalla: `xvfb-run -a node scraper`
  (`deploy.sh` lo hace solo si encuentra `xvfb-run`).
- El CMS deja vacíos `discount`, `start_date`, `end_date` y las coordenadas. El porcentaje se
  saca de la "bajada" (`"40% dcto. todos los miércoles."`) y la vigencia del texto libre
  (`"Hasta el 30 de septiembre de 2026"`), por eso se marca `fechaTerminoAproximada`. Días,
  categorías y tarjetas salen de los `tags`; comuna y región de los campos "Comuna/Región cobertura".

### BancoEstado

- **Fuente:** no hay API. Los beneficios vienen renderizados en el HTML (AEM) de cuatro listados:
  [todos-beneficios](https://www.bancoestado.cl/content/bancoestado-public/cl/es/home/home/todosuma---bancoestado-personas/todos-beneficios.html)
  y las páginas propias de Bieeneficios, Sabores (restaurantes) y Música/Entretención. Cada
  tarjeta (`.card-beneficios`) trae `data-subfiltros` (días, zona, modalidad, tarjeta); las de
  Sabores traen un modal con locales y vigencia, y las demás enlazan a una ficha con el detalle,
  que también se lee (~75 fichas).
- **Requiere navegador con ventana**, como Santander: `fetch`/curl reciben una página de error de
  Akamai y Chromium headless un HTML vacío. El adaptador abre el listado con Playwright y desde
  esa página pide los demás HTML y los lee con `DOMParser`.
- Porcentaje, tope, tarjetas y vigencia salen del texto (`fechaTerminoAproximada`). Una ficha
  puede tener varias ofertas (Rappi) y una oferta aparecer en varios listados: se deduplica por
  ficha + oferta. De los eventos solo se toman los marcados "Evento Activo".
- Tarjetas: "Visa"/"Mastercard" marcan los beneficios exclusivos de esa marca de crédito
  (casi todos los de Sabores son exclusivo Visa); CuentaRUT y Rutpay van aparte porque hay
  beneficios que las incluyen o excluyen explícitamente.

### Banco Falabella

- **Fuente:** no hay API pública, pero tampoco bloqueo: basta `fetch`. El sitio es Next.js (App
  Router) sobre Contentful y los datos vienen en el payload RSC embebido en el HTML
  (`self.__next_f.push`). [`/descuentos/todos`](https://www.bancofalabella.cl/descuentos/todos)
  trae todas las tarjetas (`benefitCardsData`, ~239) y cada ficha `/descuentos/detalle/<slug>`
  su `benefitData` (categorías, canal presencial/online, descripción y legal). Son ~230 fichas
  de ~1 MB, 4 en paralelo: menos de un minuto. Si una ficha falla (el CDN a veces da 502), el
  beneficio se arma solo con la tarjeta.
- Días, vigencia, tarjetas, regiones y canal vienen estructurados; la fecha es exacta (no se
  marca `fechaTerminoAproximada`). `discount` vale 1 en lo que no es un %, así que el porcentaje
  sale del titular de la tarjeta ("Hasta" / "40%" / "Sin Tope").
- `locations` viene vacío: los locales se leen de la descripción, con dirección cuando la trae
  ("Gerónimo de Alderete 1579, Vitacura") o como sector cuando nombra un mall ("Mall Plaza
  Vespucio"). Si el sitio marca las 16 regiones, el beneficio es nacional.
- Tarjetas: "Crédito" es la CMR Mastercard; "CMR Premium" y "CMR Elite" solo aparecen cuando el
  beneficio es exclusivo de esos niveles. El % suele ser el de la CMR (con Débito es menor; el
  detalle lo aclara).

### Banco de Chile

- **Fuente:** el listado [Todos los beneficios](https://sitiospublicos.bancochile.cl/personas/beneficios/todos-los-beneficios)
  (Modyo) se arma en el navegador con la API pública de contenido del CMS, que responde a
  `fetch` plano pese a Incapsula: `/api/content/spaces/personas/types/beneficios/entries`, 100
  por página (~860 beneficios, 9 páginas, unos segundos). "Todos" muestra todas las entradas sin
  filtrar. Si Incapsula bloquea, la API responde HTML en vez de JSON y el adaptador falla con
  ese mensaje.
- Casi todo viene estructurado: días (tags), tarjetas (`Tarjetas Permitidas`), vigencia
  (`unpublish_at`, que es cuando el sitio lo deja de mostrar; el texto "válida hasta…" solo se
  usa si falta, con `fechaTerminoAproximada`) y locales (`Sucursales`: nombre; dirección;
  región; comuna; teléfono). Porcentaje y tipo salen del titular ("20%; dto.") o de la bajada
  (cuotas sin interés, eventos); los canjes de Dólares Premio son `millas`.
- Locales: se geocodifica cada dirección. Las cadenas con más de 20 locales (Cruz Verde tiene
  723) quedan nacionales o regionales sin pines, para no pasar horas en Nominatim. Sin
  `Sucursales`, la comuna sale de los tags.
- Tarjetas: "Visa"/"Mastercard" marcan los beneficios que excluyen la otra marca (los "40% con
  todo Visa"); "Visa Infinite", "Visa Signature" y "Mastercard Black" los exclusivos de esos
  niveles, de crédito o débito.

### Agregar un banco

1. Agregarlo en `shared/bancos.ts` (nombre, sitio, tarjetas, color).
2. Crear `scraper/bancos/<id>/` con `definirBanco({ traer, transformar, ... })` y registrarlo en
   `scraper/bancos/index.ts`. `transformar` devuelve un `Beneficio` sin ubicaciones más las
   `localidades` detectadas; la geocodificación y el frontend no necesitan cambios.

### Ubicaciones

Ningún banco entrega coordenadas. La comuna o el sector se detectan en el texto
(`scraper/localidades.ts`). Luego se busca el local en Nominatim y se usa lo que se encuentre primero:
  1. `local`: la dirección del local (si el banco la da, como BancoEstado en Sabores o Banco de Chile) o el
     local por su nombre están en OpenStreetMap, dentro de la comuna.
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
en la URL, así que una búsqueda se puede compartir. El banco, las tarjetas marcadas (por banco) y los
filtros de ubicación se recuerdan en `localStorage` (`web/lib/preferencias.ts`); lo que traiga la URL
tiene prioridad. Los beneficios vencidos se ocultan según la
fecha del navegador. La página carga `beneficios.json` al abrirse, así que actualizar los datos
no requiere recompilar.

## Deploy

El sitio es estático: `scripts/deploy.sh` compila y copia `web/out` al directorio que sirve el
servidor web. Tiene dos modos (ver los comentarios del script):

- `full` — instala, compila y publica todo. Es lo que ejecuta el workflow de GitHub Actions al
  pushear a `main` (necesita los secrets `HOST` y `SSH_PRIVATE_KEY`).
- `datos` — re-scrapea los bancos y reemplaza solo `beneficios.json` en el sitio publicado, sin
  recompilar. Pensado para correr por cron:

  ```cron
  0 6 1 * * /ruta/al/repo/scripts/deploy.sh datos >> /var/log/banco-beneficios.log 2>&1
  ```

`data/` vive solo en el servidor. Si falla un banco, se publican los demás con los datos previos
del caído; si falla todo, el sitio sigue sirviendo los datos anteriores. El error queda en el log.

En el servidor, Santander necesita además: `apt install xvfb` y
`pnpm install && pnpm exec playwright install --with-deps chromium` en la raíz del repo
(~300 MB de navegador).

Variables opcionales, en un `.env` en la raíz del repo: `BCI_SUBSCRIPTION_KEY`,
`NOMINATIM_USER_AGENT`, `NOMINATIM_EMAIL`, `WWW_DIR` (destino de la publicación) y `BASE_PATH`
(si el sitio se sirve bajo un subdirectorio).

Nota: la mayoría de las ofertas vence en menos de un mes, así que un cron mensual deja pocas
vigentes al final del ciclo. Semanal (`0 6 * * 1`) cuesta lo mismo: ~4 requests a BCI y una
visita a Santander por corrida.

## Extensión futura: Google Places (opcional, de pago)

No incluida. Si se agrega, conviene un `scraper/places.ts` separado, activado solo si existe
`GOOGLE_PLACES_API_KEY`, con su propio caché (`data/placescache.json`). Debería correr después
de la geocodificación, solo sobre ubicaciones con `precision: 'local'`, y agregar campos
opcionales (`rating`, `fotos`, `horario`) a `Ubicacion`.
