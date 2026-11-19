import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { fetch } from 'undici';
import sharp from 'sharp';

import { bucketFromCard, type ColorBucket } from './colorBuckets.js';
import { encodeOfflineDb, ENTRY_VERSION, type OfflineEntry } from './binaryDb.js';
import { computePHash } from './phash.js';
import { BUCKETS, createBucketInfo, type OfflineManifest } from './offlineManifest.js';

const { values } = parseArgs({ options: {
  input: { type: 'string', default: join('data', 'scryfall-reduced.json') },
  out: { type: 'string', default: join('data', 'offline') },
  'assume-english': { type: 'boolean', default: false },
} });
const DATA_PATH = resolve(values.input);
const OUTPUT_DIR = resolve(values.out);
const CONCURRENCY = 16;

type CardData = {
  card_faces?: Array<{ image_uris?: { art_crop?: string; normal?: string } }>;
  collector_number: string;
  colors?: string[];
  color_identity?: string[];
  id: string;
  image_uris?: { art_crop?: string; normal?: string };
  lang?: string;
  name: string;
  oracle_id: string;
  set: string;
};

type ReducedDataset = {
  cards: CardData[];
  last_updated: string;
};

async function fetchBuffer(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function loadDataset(): Promise<ReducedDataset> {
  await access(DATA_PATH);
  const raw = await readFile(DATA_PATH, 'utf-8');
  return JSON.parse(raw) as ReducedDataset;
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

async function normalizeArtCrop(buffer: Buffer) {
  return sharp(buffer)
    .rotate()
    .removeAlpha()
    .resize(320, 230, { fit: 'fill' })
    .jpeg()
    .toBuffer();
}

async function processCard(
  card: CardData,
): Promise<{ bucket: ColorBucket; entry: OfflineEntry } | null> {
  const { artUrl, normalUrl } = getImageUrls(card);
  const sourceUrl = artUrl ?? normalUrl;
  if (!sourceUrl) return null;

  const collectorNumber = normalizeMetadataString(card.collector_number);
  const name = normalizeMetadataString(card.name);
  const oracleId = normalizeMetadataString(card.oracle_id);
  const set = normalizeMetadataString(card.set);
  const id = normalizeMetadataString(card.id);
  const lang = normalizeMetadataString(card.lang) || (values['assume-english'] ? 'en' : '');

  if (!collectorNumber || !name || !oracleId || !set || !id || !lang) {
    console.warn('⚠️ Skipping card with incomplete offline DB metadata:', {
      collectorNumber,
      id: card.id,
      name,
      oracleId,
      set,
    });
    return null;
  }

  const [artBuffer, normalBuffer] = await Promise.all([
    artUrl ? fetchBuffer(artUrl) : Promise.resolve(null),
    normalUrl && normalUrl !== artUrl ? fetchBuffer(normalUrl) : Promise.resolve(null),
  ]);

  const resolvedPrimary = artBuffer ?? normalBuffer;
  if (!resolvedPrimary) return null;

  const phash = await computePHash(await normalizeArtCrop(resolvedPrimary));
  const phashAlt = normalBuffer ? await computePHash(normalBuffer) : phash;

  return {
    bucket: bucketFromCard(card),
    entry: {
      id,
      lang,
      artUrl: artBuffer ? artUrl ?? '' : normalUrl ?? '',
      cn: collectorNumber,
      name,
      oracle_id: oracleId,
      phash,
      phashAlt,
      set,
    },
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R | null>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  console.log(`Loading ${DATA_PATH}`);
  const dataset = await loadDataset();
  if (!Array.isArray(dataset.cards) || !dataset.cards.length || !Number.isFinite(Date.parse(dataset.last_updated))) {
    throw new Error('Expected a non-empty dataset with cards and last_updated');
  }
  const missingLanguage = dataset.cards.filter((card) => !normalizeMetadataString(card.lang)).length;
  if (missingLanguage && !values['assume-english']) {
    throw new Error(`${missingLanguage} printings lack lang. Regenerate the reduced dataset or use --assume-english only for a verified English-only source.`);
  }
  if (missingLanguage) console.warn(`Assigning en to ${missingLanguage} printings missing lang (explicit --assume-english).`);
  console.log(`✅ Loaded ${dataset.cards.length} cards (updated: ${dataset.last_updated})`);

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
  const start = Date.now();

  const results = await runWithConcurrency(dataset.cards, CONCURRENCY, async (card) => {
    const result = await processCard(card);
    done += 1;
    if (!result) skipped += 1;
    if (done % 500 === 0 || done === dataset.cards.length) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      const pct = ((done / dataset.cards.length) * 100).toFixed(1);
      console.log(`  [${pct}%] ${done}/${dataset.cards.length} — ${skipped} skipped — ${elapsed}s elapsed`);
    }
    return result;
  });

  for (const result of results) {
    if (!result) continue;
    buckets[result.bucket].push(result.entry);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const generatedAt = new Date().toISOString();
  const version = `${generatedAt.replace(/\D/g, '')}-${randomUUID().slice(0, 8)}`;
  const manifest: OfflineManifest = {
    schema: 2,
    generated_at: generatedAt,
    source_updated: dataset.last_updated,
    version,
    generator: {
      crop_hashes: ['art_crop', 'normal'],
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
  await writeFile(join(OUTPUT_DIR, 'manifest.v2.json'), manifestJson);
  console.log(`Manifest ${version} written to ${OUTPUT_DIR} (${done - skipped}/${done} printings)`);
}

main().catch((err) => {
  console.error('💥 Offline DB build failed:', err);
  process.exit(1);
});
