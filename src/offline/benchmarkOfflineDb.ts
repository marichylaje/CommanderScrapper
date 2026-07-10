import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fetch } from 'undici';

import { computePHash } from './phash.js';
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

function hammingDistance(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  let distance = 0;

  for (let index = 0; index < maxLength; index += 1) {
    const leftNibble = Number.parseInt(left[index] ?? '0', 16);
    const rightNibble = Number.parseInt(right[index] ?? '0', 16);
    distance += ((leftNibble ^ rightNibble).toString(2).match(/1/g) || []).length;
  }

  return distance;
}

function normalizeKey(value?: string) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function loadManifest(): Promise<OfflineManifest> {
  const paths = [join(OFFLINE_DIR, 'manifest.v2.json'), join(OFFLINE_DIR, 'manifest.json')];
  for (const manifestPath of paths) {
    try {
      const raw = await readFile(manifestPath, 'utf-8');
      return JSON.parse(raw) as OfflineManifest;
    } catch {
      // Try the next manifest file.
    }
  }
  throw new Error('Offline manifest not found. Run buildOfflineDb first.');
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
    const response = await fetch(imagePath, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${imagePath}: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const resolvedPath = resolve(imagePath);
  return readFile(resolvedPath);
}

function scoreCandidate(queryHash: string, entry: OfflineEntry) {
  const primaryDistance = hammingDistance(queryHash, entry.phash);
  const alternateDistance = entry.phashAlt ? hammingDistance(queryHash, entry.phashAlt) : primaryDistance;
  const distance = Math.min(primaryDistance, alternateDistance);
  return Math.max(0, 1 - distance / 64);
}

function scoreOcrHint(entry: OfflineEntry, ocr?: BenchmarkSample['ocr']) {
  if (!ocr) return 0;

  let boost = 0;
  if (ocr.setCode && normalizeKey(ocr.setCode) === normalizeKey(entry.set)) {
    boost += 0.06;
  }
  if (ocr.collectorNumber && normalizeKey(ocr.collectorNumber) === normalizeKey(entry.cn)) {
    boost += 0.08;
  }
  if (ocr.name && normalizeKey(ocr.name) === normalizeKey(entry.name)) {
    boost += 0.08;
  }
  return boost;
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
    const queryHash = await computePHash(imageBuffer);

    const candidateBuckets = sample.bucket && bucketEntries.has(sample.bucket)
      ? [bucketEntries.get(sample.bucket)!]
      : [...bucketEntries.values()];

    const scored = candidateBuckets
      .flatMap((entries) => entries)
      .map((entry) => ({
        confidence: scoreCandidate(queryHash, entry) + scoreOcrHint(entry, sample.ocr),
        entry,
      }))
      .sort((left, right) => right.confidence - left.confidence);

    const best = scored[0];
    const expectedOracleId = sample.expectedOracleId ?? sample.expectedId ?? '';
    const hit = Boolean(best) && best.entry.oracle_id === expectedOracleId;

    results.push({
      expected: expectedOracleId,
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
