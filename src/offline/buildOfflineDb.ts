import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { fetch } from 'undici';

import { bucketFromCard, type ColorBucket } from './colorBuckets.js';
import { encodeOfflineDb, type OfflineEntry } from './binaryDb.js';
import { CROP_HASHES, ENTRY_VERSION, type RegionHashes } from './contract.js';
import { cardRegionHashes } from './cardRegionHashes.js';
import { BUCKETS, createBucketInfo, type OfflineManifest } from './offlineManifest.js';

const { values } = parseArgs({ options: {
  input: { type: 'string', default: join('data', 'paper-prints.jsonl') },
  'source-updated': { type: 'string' },
  cache: { type: 'string' },
  'budget-minutes': { type: 'string' },
  out: { type: 'string', default: join('data', 'offline') },
  'assume-english': { type: 'boolean', default: false },
  'resolve-oracle-ids': { type: 'boolean', default: false },
  'scryfall-api': { type: 'string', default: 'https://api.scryfall.com' },
} });
const DATA_PATH = resolve(values.input);
const OUTPUT_DIR = resolve(values.out);
const CONCURRENCY = 8;
const IMAGE_REQUEST_INTERVAL_MS = 100;
const API_REQUEST_INTERVAL_MS = 100;
let nextImageRequestAt = 0;
let nextApiRequestAt = 0;

type CardData = {
  games?: string[];
  card_faces?: Array<{ image_uris?: { art_crop?: string; normal?: string }; oracle_id?: string }>;
  collector_number: string;
  colors?: string[];
  color_identity?: string[];
  id: string;
  image_uris?: { art_crop?: string; normal?: string };
  lang?: string;
  name: string;
  oracle_id?: string;
  set: string;
};

type ReducedDataset = {
  cards: CardData[];
  last_updated: string;
};

async function fetchBuffer(url: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const now = Date.now();
    const start = Math.max(now, nextImageRequestAt);
    nextImageRequestAt = start + IMAGE_REQUEST_INTERVAL_MS;
    if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(25_000),
        headers: {
          'User-Agent': 'DeckBuilder/1.1 (+https://github.com/marichylaje/MTGCommanderDeckBuilder)',
          Accept: 'image/*',
        },
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) {
        console.warn(`Image HTTP ${response.status}: ${url}`);
        return 'missing';
      }
      if (response.status !== 429 && response.status < 500) {
        console.warn(`Image HTTP ${response.status}: ${url}`);
        return null;
      }
      console.warn(`Image HTTP ${response.status}, attempt ${attempt}/3: ${url}`);
    } catch (error) {
      console.warn(`Image download failed, attempt ${attempt}/3: ${url}`, error);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  return null;
}

async function* readPrintings() {
  const stream = createReadStream(DATA_PATH, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line.trim()) yield JSON.parse(line) as CardData;
  } finally {
    lines.close();
    stream.destroy();
  }
}

let loadedCards: CardData[] | undefined;

async function loadDataset() {
  if (DATA_PATH.endsWith('.jsonl')) {
    return { cards: readPrintings(), last_updated: values['source-updated'] ?? '' };
  }
  const raw = await readFile(DATA_PATH, 'utf-8');
  const data = JSON.parse(raw) as ReducedDataset;
  if (!Array.isArray(data.cards)) throw new Error('Expected { cards, last_updated } or paper-print JSONL');
  loadedCards = data.cards;
  return data;
}

function getImageUrls(card: CardData): { artUrl?: string; normalUrl?: string } {
  if (card.image_uris) {
    return { artUrl: card.image_uris.art_crop, normalUrl: card.image_uris.normal };
  }

  const firstFace = card.card_faces?.[0];
  if (firstFace?.image_uris) {
    return {
      artUrl: firstFace.image_uris.art_crop,
      normalUrl: firstFace.image_uris.normal,
    };
  }

  return {};
}

function normalizeMetadataString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function embeddedOracleId(card: CardData) {
  return normalizeMetadataString(card.oracle_id)
    || normalizeMetadataString(card.card_faces?.[0]?.oracle_id)
    || normalizeMetadataString(card.card_faces?.[1]?.oracle_id);
}

function printKey(card: CardData) {
  const set = normalizeMetadataString(card.set);
  const collectorNumber = normalizeMetadataString(card.collector_number);
  return set && collectorNumber ? `${set}\0${collectorNumber}` : '';
}

// (set, collector_number) -> oracle_id from the dump; '' marks an ambiguous key.
let oracleIndex: Promise<Map<string, string>> | undefined;
function loadOracleIndex() {
  oracleIndex ??= (async () => {
    const index = new Map<string, string>();
    for await (const card of loadedCards ?? readPrintings()) {
      const key = printKey(card);
      const oracleId = embeddedOracleId(card);
      if (!key || !oracleId) continue;
      const known = index.get(key);
      index.set(key, known === undefined || known === oracleId ? oracleId : '');
    }
    return index;
  })();
  return oracleIndex;
}

function openCache(path: string) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS hashes_v3 (url TEXT PRIMARY KEY, hashes TEXT NOT NULL)');
  // An empty oracle_id records a confirmed lookup miss so reruns do not ask Scryfall again.
  db.exec('CREATE TABLE IF NOT EXISTS oracle_ids_v3 (id TEXT PRIMARY KEY, oracle_id TEXT NOT NULL)');
  const lookup = db.prepare('SELECT hashes FROM hashes_v3 WHERE url = ?');
  const store = db.prepare('INSERT OR REPLACE INTO hashes_v3 VALUES (?, ?)');
  const lookupOracle = db.prepare('SELECT oracle_id FROM oracle_ids_v3 WHERE id = ?');
  const storeOracle = db.prepare('INSERT OR REPLACE INTO oracle_ids_v3 VALUES (?, ?)');
  return {
    get(url: string) {
      const row = lookup.get(url);
      return row && JSON.parse(String(row.hashes)) as RegionHashes;
    },
    put(url: string, hashes: RegionHashes) { store.run(url, JSON.stringify(hashes)); },
    getOracleId(id: string) {
      const row = lookupOracle.get(id);
      return row ? String(row.oracle_id) : undefined;
    },
    putOracleId(id: string, oracleId: string) { storeOracle.run(id, oracleId); },
    close() { db.close(); },
  };
}

type Cache = ReturnType<typeof openCache>;

// Returns the oracle_id, 'missing' for a definitive miss, or null for a transient failure.
async function fetchOracleId(id: string): Promise<string | 'missing' | null> {
  const url = `${values['scryfall-api'].replace(/\/+$/, '')}/cards/${encodeURIComponent(id)}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const now = Date.now();
    const start = Math.max(now, nextApiRequestAt);
    nextApiRequestAt = start + API_REQUEST_INTERVAL_MS;
    if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
    let retryAfterMs = attempt * 1000;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(25_000),
        headers: {
          'User-Agent': 'DeckBuilder/1.1 (+https://github.com/marichylaje/MTGCommanderDeckBuilder)',
          Accept: 'application/json',
        },
      });
      if (response.ok) {
        const data = await response.json() as CardData;
        return embeddedOracleId(data) || 'missing';
      }
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) return 'missing';
      if (response.status !== 429 && response.status < 500) {
        console.warn(`Oracle lookup HTTP ${response.status}: ${id}`);
        return null;
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      if (response.status === 429 && retryAfter > 0) retryAfterMs = Math.min(retryAfter, 30) * 1000;
      console.warn(`Oracle lookup HTTP ${response.status}, attempt ${attempt}/3: ${id}`);
    } catch (error) {
      console.warn(`Oracle lookup failed, attempt ${attempt}/3: ${id}`, error);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  }
  return null;
}

const oracleStats = { resolved: 0 };
let oracleApiDisabled = false;
const oracleMemo = new Map<string, string>();

// Order: embedded fields (root, faces) -> dump by (set, collector_number) -> cache -> Scryfall by id.
async function resolveOracleId(card: CardData, cache?: Cache) {
  const embedded = embeddedOracleId(card);
  if (embedded) return embedded;

  const key = printKey(card);
  const fromDump = key ? (await loadOracleIndex()).get(key) : undefined;
  if (fromDump) { oracleStats.resolved++; return fromDump; }

  const id = normalizeMetadataString(card.id);
  if (!id || !values['resolve-oracle-ids']) return '';
  const known = oracleMemo.get(id) ?? cache?.getOracleId(id);
  if (known !== undefined) {
    if (known) oracleStats.resolved++;
    return known;
  }
  if (oracleApiDisabled) return '';

  const fetched = await fetchOracleId(id);
  if (fetched === null) {
    // Transient failure: stop querying for this run and leave the cache untouched so a rerun can retry.
    if (!oracleApiDisabled) console.warn('⚠️ Scryfall oracle lookups disabled for the rest of this run');
    oracleApiDisabled = true;
    return '';
  }
  const oracleId = fetched === 'missing' ? '' : fetched;
  oracleMemo.set(id, oracleId);
  cache?.putOracleId(id, oracleId);
  if (oracleId) oracleStats.resolved++;
  return oracleId;
}

async function processCard(
  card: CardData,
  cache?: Cache,
): Promise<{ bucket: ColorBucket; entry: OfflineEntry } | null> {
  if (card.games && !card.games.includes('paper')) return null;
  const { artUrl, normalUrl } = getImageUrls(card);
  if (!normalUrl) return null;

  const collectorNumber = normalizeMetadataString(card.collector_number);
  const name = normalizeMetadataString(card.name);
  const set = normalizeMetadataString(card.set);
  const id = normalizeMetadataString(card.id);
  const lang = normalizeMetadataString(card.lang) || (values['assume-english'] ? 'en' : '');

  if (!lang) throw new Error(`Missing lang for ${id}; use --assume-english only for a verified English source`);
  const oracleId = collectorNumber && name && set && id ? await resolveOracleId(card, cache) : '';
  if (!collectorNumber || !name || !oracleId || !set || !id) {
    console.warn('⚠️ Skipping card with incomplete offline DB metadata:', {
      collectorNumber,
      id: card.id,
      name,
      oracleId,
      set,
    });
    return null;
  }

  let hashes = cache?.get(normalUrl);
  if (!hashes) {
    const normalBuffer = await fetchBuffer(normalUrl);
    if (normalBuffer === 'missing') {
      // Scryfall bulk data can list images that no longer exist; they can't be scanned anyway.
      console.warn(`⚠️ Skipping printing ${id}: full-card image no longer exists (404/410)`);
      return null;
    }
    if (!normalBuffer) throw new Error(`Cannot build complete catalog: failed to download full-card image for ${id}`);
    hashes = await cardRegionHashes(normalBuffer);
    cache?.put(normalUrl, hashes);
  }

  return {
    bucket: bucketFromCard(card),
    entry: {
      id,
      lang,
      artUrl: artUrl ?? normalUrl,
      cn: collectorNumber,
      name,
      oracle_id: oracleId,
      ...hashes,
      set,
    },
  };
}

async function main() {
  console.log(`Loading ${DATA_PATH}`);
  const dataset = await loadDataset();
  if (!Number.isFinite(Date.parse(dataset.last_updated))) {
    throw new Error('Expected source timestamp (pass --source-updated for JSONL)');
  }
  const budget = Number(values['budget-minutes'] ?? Infinity);
  if (!(budget > 0) || (values['budget-minutes'] && !values.cache)) {
    throw new Error('--budget-minutes requires a positive budget and --cache');
  }

  const buckets: Record<ColorBucket, OfflineEntry[]> = {
    W: [],
    U: [],
    B: [],
    R: [],
    G: [],
    C: [],
    M: [],
  };

  let done = 0;
  let skipped = 0;
  const deadline = Date.now() + budget * 60_000;
  const cache = values.cache ? openCache(values.cache) : undefined;
  const ids = new Set<string>();
  const batch: CardData[] = [];
  async function flush() {
    for (const result of await Promise.all(batch.splice(0).map((card) => processCard(card, cache)))) {
      done++;
      if (!result) { skipped++; continue; }
      if (ids.has(result.entry.id)) throw new Error(`Duplicate printing ID: ${result.entry.id}`);
      ids.add(result.entry.id);
      buckets[result.bucket].push(result.entry);
    }
    if (done % 1000 === 0) console.log(`${done} input records processed, ${skipped} skipped`);
  }
  try {
    for await (const card of dataset.cards) {
      if (Date.now() >= deadline) {
        console.log(`Budget reached after ${done} records; hashes checkpointed. No manifest written.`);
        process.exitCode = 75;
        return;
      }
      batch.push(card);
      if (batch.length === CONCURRENCY) await flush();
    }
    if (batch.length) await flush();
  } finally {
    cache?.close();
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const generatedAt = new Date().toISOString();
  const version = `${generatedAt.replace(/\D/g, '')}-${randomUUID().slice(0, 8)}`;
  const manifest: OfflineManifest = {
    schema: 3,
    generated_at: generatedAt,
    source_updated: dataset.last_updated,
    version,
    generator: {
      crop_hashes: CROP_HASHES,
      entry_version: ENTRY_VERSION,
      visual_buckets: false,
    },
    buckets: {},
  };

  if (!BUCKETS.some((bucket) => buckets[bucket].length)) throw new Error('No usable printings generated');
  for (const bucket of BUCKETS) {
    const encoded = encodeOfflineDb(buckets[bucket]);
    const gzipped = gzipSync(encoded.buffer, { level: 9 });
    const file = `cards-${bucket}.${version}.bin.gz`;
    manifest.buckets[bucket] = createBucketInfo(file, buckets[bucket].length, gzipped);
    const outputPath = join(OUTPUT_DIR, file);
    await writeFile(outputPath, gzipped);
    console.log(`✅ Wrote ${bucket} bucket (${buckets[bucket].length} cards)`);
  }

  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestPath = join(OUTPUT_DIR, 'manifest.v3.json');
  await writeFile(`${manifestPath}.${version}`, manifestJson);
  await rename(`${manifestPath}.${version}`, manifestPath);
  console.log(`Manifest ${version} written to ${OUTPUT_DIR} (${done - skipped}/${done} printings, ${oracleStats.resolved} oracle IDs recovered)`);
}

main().catch((err) => {
  console.error('💥 Offline DB build failed:', err);
  process.exit(1);
});
