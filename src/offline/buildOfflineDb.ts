import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fetch } from 'undici';
import sharp from 'sharp';

import { bucketFromCard, type ColorBucket } from './colorBuckets.js';
import { encodeOfflineDb, type OfflineEntry } from './binaryDb.js';
import { computePHash } from './phash.js';

const DATA_PATH = join(process.cwd(), 'data', 'scryfall-reduced.json');
const OUTPUT_DIR = join(process.cwd(), 'data', 'offline');
const CONCURRENCY = 16;
const MANIFEST_VERSION = 2;

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

type Manifest = {
  buckets: Record<ColorBucket, { count: number; file: string; url?: string }>;
  generated_at: string;
  generator: {
    crop_hashes: string[];
    entry_version: number;
    visual_buckets: boolean;
  };
  schema: number;
  source_updated: string;
  version: string;
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

  const [primaryBuffer, artBuffer, normalBuffer] = await Promise.all([
    fetchBuffer(sourceUrl),
    artUrl && artUrl !== sourceUrl ? fetchBuffer(artUrl) : Promise.resolve(null),
    normalUrl && normalUrl !== sourceUrl ? fetchBuffer(normalUrl) : Promise.resolve(null),
  ]);

  const resolvedPrimary = primaryBuffer ?? artBuffer ?? normalBuffer;
  if (!resolvedPrimary) return null;

  const resolvedArt = artBuffer ?? resolvedPrimary;
  const resolvedNormal = normalBuffer ?? resolvedPrimary;

  const phash = await computePHash(await normalizeArtCrop(resolvedArt));
  const phashAlt = await computePHash(resolvedNormal);

  return {
    bucket: bucketFromCard(card),
    entry: {
      cn: card.collector_number,
      name: card.name,
      oracle_id: card.oracle_id,
      phash,
      phashAlt,
      set: card.set,
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
  console.log('📖 Loading scryfall-reduced.json...');
  const dataset = await loadDataset();
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

  const manifest: Manifest = {
    schema: MANIFEST_VERSION,
    generated_at: new Date().toISOString(),
    source_updated: dataset.last_updated,
    version: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    generator: {
      crop_hashes: ['art_crop', 'normal'],
      entry_version: 2,
      visual_buckets: true,
    },
    buckets: {
      W: { count: buckets.W.length, file: 'cards-W.bin.gz' },
      U: { count: buckets.U.length, file: 'cards-U.bin.gz' },
      B: { count: buckets.B.length, file: 'cards-B.bin.gz' },
      R: { count: buckets.R.length, file: 'cards-R.bin.gz' },
      G: { count: buckets.G.length, file: 'cards-G.bin.gz' },
      C: { count: buckets.C.length, file: 'cards-C.bin.gz' },
      M: { count: buckets.M.length, file: 'cards-M.bin.gz' },
    },
  };

  for (const bucket of Object.keys(buckets) as ColorBucket[]) {
    const buffer = encodeOfflineDb(buckets[bucket]);
    const gzipped = gzipSync(buffer, { level: 9 });
    const outputPath = join(OUTPUT_DIR, manifest.buckets[bucket].file);
    await writeFile(outputPath, gzipped);
    console.log(`✅ Wrote ${bucket} bucket (${buckets[bucket].length} cards)`);
  }

  const manifestJson = JSON.stringify(manifest, null, 2);
  await writeFile(join(OUTPUT_DIR, 'manifest.json'), manifestJson);
  await writeFile(join(OUTPUT_DIR, 'manifest.v2.json'), manifestJson);
  console.log('✅ Manifest written to data/offline/manifest.json and manifest.v2.json');
}

main().catch((err) => {
  console.error('💥 Offline DB build failed:', err);
  process.exit(1);
});
