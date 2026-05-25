/**
 * buildFingerprintIndex.ts
 *
 * One-time script to pre-compute visual fingerprints for all cards in
 * scryfall-reduced.json and save the result to data/fingerprint-index.json.
 *
 * Run with: npx tsx src/buildFingerprintIndex.ts
 *
 * Outputs: data/fingerprint-index.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetch } from 'undici';
import sharp from 'sharp';

const DATA_PATH = join(process.cwd(), 'data', 'scryfall-reduced.json');
const OUTPUT_PATH = join(process.cwd(), 'data', 'fingerprint-index.json');
const CONCURRENCY = 20;
const HASH_SIZE = 16;
const HISTOGRAM_BINS = 4;
const ART_REGION = { height: 0.37, width: 0.84, x: 0.08, y: 0.12 };

type CardData = {
  card_faces?: Array<{ image_uris?: { art_crop?: string; normal?: string } }>;
  collector_number: string;
  id: string;
  image_uris?: { art_crop?: string; normal?: string };
  name: string;
  oracle_id: string;
  set: string;
};

type FingerprintEntry = {
  artHash: string;
  cn: string;
  fullHash: string;
  histogram: number[];
  id: string;
  name: string;
  oracle_id: string;
  set: string;
};

type ReducedDataset = { cards: CardData[]; last_updated: string };

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function computeDHash(buffer: Buffer): Promise<string> {
  const { data, info } = await sharp(buffer)
    .rotate()
    .greyscale()
    .resize(HASH_SIZE + 1, HASH_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bits: string[] = [];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width - 1; x++) {
      const left = data[y * info.width + x] ?? 0;
      const right = data[y * info.width + x + 1] ?? 0;
      bits.push(left > right ? '1' : '0');
    }
  }

  let hash = '';
  for (let i = 0; i < bits.length; i += 4) {
    hash += Number.parseInt(bits.slice(i, i + 4).join(''), 2).toString(16);
  }
  return hash;
}

async function computeHistogram(buffer: Buffer): Promise<number[]> {
  const bins = HISTOGRAM_BINS;
  const histogram = new Array<number>(bins * bins * bins).fill(0);
  const { data } = await sharp(buffer)
    .rotate()
    .resize(48, 48, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 3) {
    const r = Math.min(bins - 1, Math.floor(((data[i] ?? 0) / 256) * bins));
    const g = Math.min(bins - 1, Math.floor(((data[i + 1] ?? 0) / 256) * bins));
    const b = Math.min(bins - 1, Math.floor(((data[i + 2] ?? 0) / 256) * bins));
    histogram[r * bins * bins + g * bins + b] += 1;
  }

  const total = histogram.reduce((s, v) => s + v, 0) || 1;
  return histogram.map((v) => v / total);
}

async function extractArtRegion(buffer: Buffer): Promise<Buffer> {
  const img = sharp(buffer).rotate().removeAlpha();
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= 0 || h <= 0) return buffer;

  const left = Math.round(ART_REGION.x * w);
  const top = Math.round(ART_REGION.y * h);
  const width = Math.max(1, Math.min(w - left, Math.round(ART_REGION.width * w)));
  const height = Math.max(1, Math.min(h - top, Math.round(ART_REGION.height * h)));

  return img.extract({ height, left, top, width }).jpeg().toBuffer();
}

async function computeFingerprint(
  fullBuffer: Buffer,
  artBuffer?: Buffer | null,
): Promise<{ artHash: string; fullHash: string; histogram: number[] }> {
  const normalizedFull = await sharp(fullBuffer)
    .rotate()
    .removeAlpha()
    .resize(488, 680, { fit: 'fill' })
    .jpeg()
    .toBuffer();

  const artSource = artBuffer
    ? await sharp(artBuffer).rotate().removeAlpha().jpeg().toBuffer()
    : await extractArtRegion(normalizedFull);

  return {
    artHash: await computeDHash(artSource),
    fullHash: await computeDHash(normalizedFull),
    histogram: await computeHistogram(normalizedFull),
  };
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

async function processCard(card: CardData): Promise<FingerprintEntry | null> {
  const { artUrl, normalUrl } = getImageUrls(card);
  if (!normalUrl) return null;

  const fullBuffer = await fetchBuffer(normalUrl);
  if (!fullBuffer) return null;

  const artBuffer = artUrl ? await fetchBuffer(artUrl) : null;

  try {
    const fingerprint = await computeFingerprint(fullBuffer, artBuffer);
    return {
      ...fingerprint,
      cn: card.collector_number,
      id: card.id,
      name: card.name,
      oracle_id: card.oracle_id,
      set: card.set,
    };
  } catch {
    return null;
  }
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
  const raw = await readFile(DATA_PATH, 'utf-8');
  const dataset = JSON.parse(raw) as ReducedDataset;
  const cards = dataset.cards;
  console.log(`✅ Loaded ${cards.length} cards (updated: ${dataset.last_updated})`);

  const startTime = Date.now();
  let done = 0;
  let skipped = 0;

  console.log(`🔄 Computing fingerprints with ${CONCURRENCY} concurrent workers...`);

  const entries = await runWithConcurrency(cards, CONCURRENCY, async (card, i) => {
    const result = await processCard(card);
    done++;
    if (!result) skipped++;

    if (done % 500 === 0 || done === cards.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const pct = ((done / cards.length) * 100).toFixed(1);
      const eta = done > 0
        ? (((Date.now() - startTime) / done) * (cards.length - done) / 1000).toFixed(0)
        : '?';
      console.log(`  [${pct}%] ${done}/${cards.length} — ${skipped} skipped — ${elapsed}s elapsed, ~${eta}s remaining`);
    }

    return result;
  });

  const valid = entries.filter((e): e is FingerprintEntry => e !== null);
  console.log(`\n✅ ${valid.length} fingerprints computed, ${skipped} cards skipped`);

  const output = {
    generated_at: new Date().toISOString(),
    source_updated: dataset.last_updated,
    total: valid.length,
    entries: valid,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output), 'utf-8');
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`💾 Saved to ${OUTPUT_PATH} (${elapsed}s total)`);
}

main().catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
