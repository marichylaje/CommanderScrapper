import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fetch } from 'undici';

import { cardRegionHashes } from './cardRegionHashes.js';
import { LOCAL_MANIFEST } from './offlineManifest.js';
import { regionDistance } from './regionDistance.js';
import { decodeOfflineDb, type OfflineEntry } from './binaryDb.js';

const OFFLINE_DIR = join(process.cwd(), 'data', 'offline');
const DEFAULT_DATASET = join(OFFLINE_DIR, 'benchmark-dataset.example.json');

type BenchmarkSample = {
  bucket?: string;
  expectedId?: string;
  expectedOracleId?: string;
  imagePath: string;
  ocr?: {
    collectorNumber?: string;
    name?: string;
    setCode?: string;
  };
};

type BenchmarkDataset = {
  samples: BenchmarkSample[];
};

type OfflineManifest = {
  buckets: Record<string, { count: number; file: string }>;
  version?: string;
};

function normalizeKey(value?: string) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function loadManifest(): Promise<OfflineManifest> {
  return JSON.parse(await readFile(LOCAL_MANIFEST, 'utf8')) as OfflineManifest;
}

async function loadBucketEntries(fileName: string): Promise<OfflineEntry[]> {
  const raw = await readFile(join(OFFLINE_DIR, fileName));
  const decoded = decodeOfflineDb(gunzipSync(raw));
  return decoded.entries;
}

async function loadDataset(datasetPath: string): Promise<BenchmarkDataset> {
  const raw = await readFile(datasetPath, 'utf-8');
  return JSON.parse(raw) as BenchmarkDataset;
}

async function loadImageBuffer(imagePath: string) {
  if (/^https?:\/\//i.test(imagePath)) {
    const response = await fetch(imagePath, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        'User-Agent': 'DeckBuilder/1.1 (+https://github.com/marichylaje/MTGCommanderDeckBuilder)',
        Accept: 'image/*',
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${imagePath}: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const resolvedPath = resolve(imagePath);
  return readFile(resolvedPath);
}

async function main() {
  const datasetPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_DATASET;
  const manifest = await loadManifest();
  const dataset = await loadDataset(datasetPath);

  const bucketEntries = new Map<string, OfflineEntry[]>();
  for (const [bucket, info] of Object.entries(manifest.buckets)) {
    bucketEntries.set(bucket, await loadBucketEntries(info.file));
  }

  const results = [] as Array<{
    expected: string;
    hit: boolean;
    latencyMs: number;
    topConfidence: number;
    topOracleId: string;
  }>;

  for (const sample of dataset.samples) {
    const startedAt = Date.now();
    const imageBuffer = await loadImageBuffer(sample.imagePath);
    const query = await cardRegionHashes(imageBuffer);

    const candidateBuckets = sample.bucket && bucketEntries.has(sample.bucket)
      ? [bucketEntries.get(sample.bucket)!]
      : [...bucketEntries.values()];

    const scored = candidateBuckets
      .flatMap((entries) => entries)
      .map((entry) => ({
        confidence: 1 - regionDistance(query, entry) / 64,
        entry,
      }))
      .sort((left, right) => right.confidence - left.confidence);

    const winner = scored[0];
    const best = winner && sample.ocr?.setCode && sample.ocr?.collectorNumber
      ? scored.find(({ entry, confidence }) =>
        entry.oracle_id === winner.entry.oracle_id && winner.confidence - confidence <= 2 / 64 &&
        normalizeKey(entry.set) === normalizeKey(sample.ocr?.setCode) &&
        normalizeKey(entry.cn).replace(/^0+(?=\d)/, '') ===
          normalizeKey(sample.ocr?.collectorNumber).replace(/^0+(?=\d)/, '')) ?? winner
      : winner;
    const expected = sample.expectedId ?? sample.expectedOracleId ?? '';
    const hit = Boolean(best) && (sample.expectedId
      ? best.entry.id === sample.expectedId
      : best.entry.oracle_id === sample.expectedOracleId);

    results.push({
      expected,
      hit,
      latencyMs: Date.now() - startedAt,
      topConfidence: best?.confidence ?? 0,
      topOracleId: best?.entry.oracle_id ?? '',
    });
  }

  const total = results.length || 1;
  const top1 = results.filter((item) => item.hit).length / total;
  const avgLatency = results.reduce((sum, item) => sum + item.latencyMs, 0) / total;

  const report = {
    dataset: datasetPath,
    manifestVersion: manifest.version ?? 'unknown',
    samples: results.length,
    top1Accuracy: Number(top1.toFixed(4)),
    averageLatencyMs: Number(avgLatency.toFixed(1)),
    results,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('💥 Offline DB benchmark failed:', error);
  process.exit(1);
});
