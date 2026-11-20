# CommanderScrapper

Pipeline de scraping y procesamiento de datos de cartas (MTG), con utilidades para:

- obtener y reducir datasets,
- generar precios,
- preparar/importar datos en Typesense,
- construir y publicar base offline para el scanner,
- exponer endpoints API para búsqueda y matching visual.

## Requisitos

- Node.js **22.x** (definido en `engines`).
- npm.

## Instalación

```bash
git clone https://github.com/marichylaje/CommanderScrapper.git
cd CommanderScrapper
npm install
```

## Desarrollo local

```bash
npm run dev
```

Esto levanta el entorno local con Vercel (`vercel dev`) para probar los endpoints de `api/`.

## Scripts principales

### Flujo completo (refresh de datos + reindex)

```bash
npm run scrape
npm run reduce
npm run prices
npm run deleteCollection
npm run typeSchema
npm run importCollection
npm run restartFly
```

`npm run prices` genera dos archivos que consume la app desde GitHub raw:

- `data/reduced-prices.json`: precio por `oracle_id`; `eur` es el `low` de Cardmarket de la impresión representativa cuando existe.
- `data/printing-prices.json`: `{ version: 1, prices: { "set/collector_number": [eurLowCents, eurLowFoilCents, usdCents, usdFoilCents, finishes] } }`. `finishes` es una máscara (1 normal, 2 foil, 4 etched). El `low` sale del price guide público de Cardmarket cruzado por `cardmarket_id`; sin ese dato se usa el precio de Scryfall. La clave no incluye el idioma. El job diario de GitHub Actions lo commitea junto a `reduced-prices.json`.

### Cambio de schema en Typesense

```bash
npm run deleteCollection
npm run typeSchema
npm run importCollection
npm run restartFly
```

### Scanner offline (backend)

**Contrato v3.** Siete buckets gzip, `data/offline/manifest.v3.json`, `schema: 3`,
`entry_version: 3` y `crop_hashes: ["art","normal","center","left","right"]` (orden exacto).
Cabecera de 24 bytes: `TCGDB1`, versión `u16`, número de filas, número de cadenas,
offset de filas y offset de cadenas (`u32`, little-endian). Cada fila de **68 bytes**
empieza con siete índices `u32` (`id`, `oracle_id`, `name`, `set`, `cn`, `lang`, `artUrl`).
La tabla de cadenas usa longitud en bytes `u16` + UTF-8. Cada hash se guarda
como dos `u32` LE: **primero la mitad alta, después la baja**.

| Offset en fila | Campo | Región `(x, y, ancho, alto)` |
|---:|---|---|
| 28 | `phash` | `(16,40,288,215)` |
| 36 | `phashAlt` | carta completa `(0,0,320,448)` |
| 44 | `phashCenter` | `(38,81,243,260)` |
| 52 | `phashLeft` | `(32,90,128,180)` |
| 60 | `phashRight` | `(160,90,128,180)` |

Las cinco regiones vienen de la misma imagen `normal`, orientada y redimensionada
a 320×448; `art_crop` es solo metadato. Cada región pasa a gris 32×32. El filtro
3×3 `[1,2,1]` separable replica bordes y redondea una sola vez tras dividir por 16.
Se limita cada valor al intervalo de los valores filtrados ordenados `[51,972]`
(índices desde cero). Se mantiene la DCT: bloque 8×8 con DC, orden `u,v`, bit 1 si
supera la mediana superior. El benchmark compara regiones correspondientes y usa
`floor((suma de las tres menores distancias Hamming + 1)/3)`.

**Cobertura.** No usar `npm run reduce` ni `scryfall-reduced.json` para un catálogo
completo: agrupan por oráculo y pueden perder Secret Lair y otras ilustraciones.
`preparePaperPrints.sh` lee el array `all_cards` por streaming, conserva cada ID
de impresión cuyo `games` contiene `paper`, incluidos idiomas y variantes, y escribe
JSONL con su fecha de origen. No se agrupa por `oracle_id`; duplicar un ID de
impresión es un error. Se indexa solo la cara frontal. Faltas de `normal` o de
identidad se omiten y se cuentan; si falta el idioma con imagen utilizable o falla
la descarga de una URL presente, el build falla. Imágenes compartidas no permiten
distinguir siempre idioma o impresión solo por visión.

```bash
# Node 22.13+; la preparación usa Bash, curl y jq 1.7+
npm run build
npm run testOfflineDb
bash scripts/preparePaperPrints.sh
npm run buildOfflineDb -- --source-updated "$(cat data/paper-prints.updated)" --cache data/hashes-v3.sqlite --budget-minutes 90
npm run validateOfflineDb
```

**Límites operativos.** Un máximo de 8 cartas simultáneas, inicios de petición
separados por 100 ms (≤36 000/h; menos con latencia y reintentos), hasta 3
intentos y 25 s por petición. Un catálogo frío requiere múltiples ejecuciones;
no hay límite artificial de impresiones. El workflow manual `offline-db-v3`
reserva 90 min para hashes dentro de 180 min totales. Al agotar el presupuesto
(código 75) termina el lote en curso sin publicar ni sustituir el manifiesto.
Relanzar para continuar: SQLite conserva hashes por URL completa, no imágenes,
y los metadatos se leen de nuevo para el snapshot actual. Si expira la caché de
Actions se recalcula; invalidar la caché local si cambian los hashes o el contenido
en una URL inmutable. El input JSONL se lee por lotes; las filas compactas para
los siete buckets sí deben caber en memoria (4 GiB de heap en CI). Un bucket
descomprimido de más de 64 MiB **falla**, no se trunca. `--input archivo.json`
admite `{ last_updated, cards }` para fixtures pequeños de papel; su cobertura es
la del archivo. `--assume-english` solo para una fuente antigua verificada como
exclusivamente inglesa. Medir precisión con `npm run benchmarkOfflineDb -- <dataset-real>`;
la muestra vacía del repo no constituye una evaluación.

**Publicación coordinada.** El workflow de fingerprints ya no publica catálogos
offline. Los clientes antiguos conservan `/api/offline-db/manifest`, sus variables
v2 y `offline-db/latest.json`. Nunca apuntarlos a v3. Para v3, `npm run uploadOfflineDb`
con `BLOB_READ_WRITE_TOKEN` valida localmente, sube una candidata versionada y verifica
por HTTPS los siete buckets (SHA-256, versión, conteos e identidad); por defecto
no mueve ningún alias. Guardar la URL y `version`. Fijar `OFFLINE_DB_MANIFEST_V3_URL`
en Preview a esa candidata; el nuevo endpoint devuelve 503 si la fuente no es válida.
Sin pin, lee `OFFLINE_DB_LATEST_V3_URL` o `offline-db/latest-v3.json`.

```powershell
npm run validateOfflineDb -- --manifest "https://<preview>/api/offline-db/manifest-v3" --version "<version-generada>"
```

Probar descarga limpia, actualización desde v2, impresión alternativa, reinicio
sin red y que el cliente anterior aún recibe v2. Solo tras verificar, promover
con `npm run uploadOfflineDb -- --promote-latest` sobre los mismos archivos
locales (o elegir `promote` en el workflow para promover su build verificado).
Validar la versión en el endpoint de producción antes de liberar la app v3.
Para rollback, fijar la URL de la última **v3** conocida y conservar sus blobs;
no devolver una v2 al nuevo cliente.

### Otros scripts útiles

- `npm run build`: type-check + build TypeScript.
- `npm run buildIndex`: reconstruye el índice de fingerprints.
- `npm run uploadReduced`: sube el dataset reducido de Scryfall.
- `npm run uploadBlob`: sube artefactos al blob storage.
- `npm run splitCommander` / `npm run splitInfluencer`: divide datasets en chunks.
- `npm run tryGetCard` / `npm run testBulk`: pruebas manuales rápidas.

## Endpoints API relevantes

- `POST /api/scanner/telemetry`
- `GET /api/offline-db/manifest`
- `GET /api/offline-db/manifest-v3`
- `/api/cards`
- `POST /api/cards/search`
- `/api/cards/prints`
- `POST /api/cards/bulk`
- `POST /api/cards/visual-match`
- `POST /api/cards/visual-match-direct`
- `POST /api/cards/visual-rerank`

El endpoint offline **v2** prioriza `OFFLINE_DB_MANIFEST_V2_URL` (para fijar una versión), luego
`offline-db/latest.json` de Blob (o `OFFLINE_DB_LATEST_URL`) y finalmente el manifiesto local
con URLs. Solo sirve manifiestos de esquema 2 con `entry_version` 2 y los tres hashes
(`art_crop`, `normal`, `center_12_18_76_58`); `OFFLINE_DB_MANIFEST_URL` (esquema 1) se ignora.
Si el Scanner muestra «Catálogo no disponible», comprobar que el endpoint devuelve el `version` esperado.
El manifiesto generado localmente no es publicable hasta que tenga URLs para los siete buckets.
