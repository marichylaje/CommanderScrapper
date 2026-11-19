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

### Cambio de schema en Typesense

```bash
npm run deleteCollection
npm run typeSchema
npm run importCollection
npm run restartFly
```

### Scanner offline (backend)

El generador produce `TCGDB1` v2 para los lectores de DeckBuilder: cabecera de
24 bytes, filas de 52 bytes con siete índices de texto (`id`, `oracle_id`,
nombre, set, número, idioma y URL), tres pHashes de 64 bits (arte, carta completa
y centro) y cadenas UTF-8
precedidas por su longitud `u16` little-endian. Cada ejecución genera una
versión nueva, siete buckets gzip y `data/offline/manifest.v2.json`.
Los antiguos buckets de 36/44 bytes no son compatibles: regenerar y publicar
el catálogo antes de usar la app nueva. El centro corresponde a `x=12%`,
`y=18%`, `ancho=76%`, `alto=58%` de la carta completa normalizada a 320×448.
Una impresión sin URL de imagen completa se omite y se informa en el log; si
existe una URL pero falla la descarga tras los reintentos, se interrumpe la
generación para no publicar silenciosamente un catálogo incompleto.

```powershell
npm run build
npm run testOfflineDb
npm run reduce -- --force
npm run buildOfflineDb
npm run validateOfflineDb
npm run uploadOfflineDb
```

Usar Node.js 22 y configurar `BLOB_READ_WRITE_TOKEN` en el entorno antes de
subir. `reduce -- --force` conserva `lang` de Scryfall incluso si su fecha no
cambió. Para un dataset antiguo verificado como **solo inglés**, se puede usar
`npm run buildOfflineDb -- --assume-english` en lugar de regenerarlo; no usarlo
para una fuente multilingüe. `default_cards` no es un inventario de todos los
idiomas; el generador admite `--input <archivo>` con `{ last_updated, cards }`
si se prepara otra fuente de impresiones. Opcionalmente usar
`npm run benchmarkOfflineDb -- <dataset-real>` para medir aciertos; la muestra
del repositorio no valida precisión.

La subida valida los bytes antes de escribir en Blob y vuelve a comprobar los
siete buckets por HTTPS. Por defecto solo sube una versión candidata, sin
modificar `offline-db/latest.json`. Guardar la URL `Versioned manifest` y el
valor `version` de la salida. Configurar `OFFLINE_DB_MANIFEST_V2_URL` en el
entorno Vercel elegido con esa URL y redesplegar. Probar primero en Preview o
en un entorno de prueba. `--promote-latest` es opt-in para mover el alias
estable y lo usa el workflow programado; si producción apunta a ese alias,
coordinar o pausar el workflow durante la primera publicación.

```powershell
npm run validateOfflineDb -- --manifest "https://commander-scrapper.vercel.app/api/offline-db/manifest" --version "<version-generada>"
```

Confirmar en una instalación limpia: abrir Scanner con red, esperar la carga,
escanear varias cartas y revisar set/número/idioma. Después cerrar el proceso,
activar modo avión y volver a abrir y escanear sin borrar datos. Probar también
una instalación con un catálogo anterior: descargar el catálogo nuevo y repetir en frío.
Una instalación limpia sin descargas no debe poder escanear offline. Conservar
una URL alternativa únicamente si apunta al mismo formato de 52 bytes; un
catálogo anterior no funciona con esta app. No borrar los blobs anteriores
hasta pasar estas pruebas.

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
- `/api/cards`
- `POST /api/cards/search`
- `/api/cards/prints`
- `POST /api/cards/bulk`
- `POST /api/cards/visual-match`
- `POST /api/cards/visual-match-direct`
- `POST /api/cards/visual-rerank`

El endpoint offline prioriza `OFFLINE_DB_MANIFEST_V2_URL` (para fijar una versión), luego
`offline-db/latest.json` de Blob (o `OFFLINE_DB_LATEST_URL`) y finalmente el manifiesto local
con URLs. Solo sirve manifiestos de esquema 2 con `entry_version` 2 y los tres hashes
(`art_crop`, `normal`, `center_12_18_76_58`); `OFFLINE_DB_MANIFEST_URL` (esquema 1) se ignora.
Si el Scanner muestra «Catálogo no disponible», comprobar que el endpoint devuelve el `version` esperado.
El manifiesto generado localmente no es publicable hasta que tenga URLs para los siete buckets.
