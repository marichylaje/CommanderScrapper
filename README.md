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

```bash
npm run buildOfflineDb
npm run benchmarkOfflineDb
npm run uploadOfflineDb
```

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

El manifest offline sirve `manifest.v2.json` con fallback a `manifest.json`.
