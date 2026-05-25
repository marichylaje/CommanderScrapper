/**
 * fingerprintIndex.ts
 *
 * Loads the pre-computed fingerprint index from data/fingerprint-index.json
 * and provides fast nearest-neighbor visual matching.
 *
 * Usage:
 *   import { findBestVisualMatch } from './fingerprintIndex';
 *   const matches = await findBestVisualMatch(fingerprint, 5);
 */

import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const INDEX_PATH = join(process.cwd(), 'data', 'fingerprint-index.json');
const INDEX_URL =
  process.env.FINGERPRINT_INDEX_URL || process.env.BLOB_FINGERPRINT_URL;
const IS_VERCEL = Boolean(process.env.VERCEL);

export type FingerprintEntry = {
  artHash: string;
  cn: string;
  fullHash: string;
  histogram: number[];
  id: string;
  name: string;
  oracle_id: string;
  set: string;
  titleHash?: string;
};

export type VisualMatchResult = {
  artHashDistance: number;
  colorDistance: number;
  confidence: number;
  entry: FingerprintEntry;
  fullHashDistance: number;
};

type FingerprintIndex = {
  entries: FingerprintEntry[];
  generated_at: string;
  source_updated: string;
  total: number;
};

let indexCache: FingerprintEntry[] | null = null;
let loadPromise: Promise<FingerprintEntry[]> | null = null;

async function loadIndex(): Promise<FingerprintEntry[]> {
  if (indexCache) return indexCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    let data: FingerprintIndex | null = null;

    if (INDEX_URL) {
      try {
        const response = await fetch(INDEX_URL, {
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        data = (await response.json()) as FingerprintIndex;
        console.log(
          `✅ Fingerprint index loaded from URL: ${data.total} cards (generated: ${data.generated_at})`,
        );
      } catch (error) {
        console.warn(
          `⚠️ Failed to fetch fingerprint index from URL (hasUrl=${Boolean(INDEX_URL)}). Falling back to local file.`,
          error,
        );
      }
    } else {
      console.warn(
        `⚠️ FINGERPRINT_INDEX_URL is not set (isVercel=${IS_VERCEL}). Falling back to local file.`,
      );
    }

    if (!data) {
      try {
        await access(INDEX_PATH);
        const raw = await readFile(INDEX_PATH, 'utf-8');
        data = JSON.parse(raw) as FingerprintIndex;
        console.log(
          `✅ Fingerprint index loaded from file: ${data.total} cards (generated: ${data.generated_at})`,
        );
      } catch (error) {
        const reason = INDEX_URL
          ? 'URL fetch failed and local file is missing'
          : 'FINGERPRINT_INDEX_URL is missing and local file is missing';
        throw new Error(`Fingerprint index unavailable: ${reason}.`);
      }
    }

    indexCache = data.entries;
    return indexCache;
  })();

  return loadPromise;
}

// Pre-warm the index immediately when this module is imported
loadIndex().catch((err) => {
  console.warn('⚠️ Failed to pre-warm fingerprint index:', err);
});

function hammingDistance(left: string, right: string): number {
  const maxLen = Math.max(left.length, right.length);
  let distance = 0;
  for (let i = 0; i < maxLen; i++) {
    const l = Number.parseInt(left[i] ?? '0', 16);
    const r = Number.parseInt(right[i] ?? '0', 16);
    const xor = l ^ r;
    distance += (xor.toString(2).match(/1/g) ?? []).length;
  }
  return distance;
}

function histogramDistance(left: number[], right: number[]): number {
  const maxLen = Math.max(left.length, right.length);
  let sum = 0;
  for (let i = 0; i < maxLen; i++) {
    sum += Math.abs((left[i] ?? 0) - (right[i] ?? 0));
  }
  return sum / 2;
}

function scoreEntry(
  query: { artHash: string; fullHash: string; histogram: number[]; titleHash: string },
  candidate: FingerprintEntry,
): Omit<VisualMatchResult, 'entry'> {
  const maxHashBits = 16 * 16; // HASH_SIZE^2
  const artHashDistance = hammingDistance(query.artHash, candidate.artHash);
  const fullHashDistance = hammingDistance(query.fullHash, candidate.fullHash);
  const colorDistance = histogramDistance(query.histogram, candidate.histogram);
  const hasTitle = Boolean(candidate.titleHash && query.titleHash);
  const titleHashDistance = hasTitle
    ? hammingDistance(query.titleHash, candidate.titleHash!)
    : 0;

  const normalizedArt = artHashDistance / maxHashBits;
  const normalizedFull = fullHashDistance / maxHashBits;
  const normalizedTitle = hasTitle ? titleHashDistance / maxHashBits : 0;

  // Dynamic weighting: prioritize art when it matches very closely
  const artWeight = normalizedArt < 0.05 ? 0.55 : normalizedArt < 0.15 ? 0.45 : 0.35;
  const fullWeight = normalizedArt < 0.05 ? 0.3 : normalizedArt < 0.15 ? 0.4 : 0.5;
  const colorWeight = 1.0 - artWeight - fullWeight;

  const weightedDistance =
    normalizedFull * fullWeight +
    normalizedArt * artWeight +
    colorDistance * colorWeight;

  let titleWeight = 0;
  if (hasTitle && normalizedArt >= 0.05) {
    titleWeight = normalizedArt < 0.15 ? 0.12 : 0.08;
  }

  const weightedWithTitle =
    titleWeight > 0
      ? weightedDistance * (1 - titleWeight) + normalizedTitle * titleWeight
      : weightedDistance;

  let confidence = Math.max(0, Math.min(1, 1 - weightedWithTitle));
  if (normalizedArt < 0.03 && colorDistance < 0.1) {
    confidence = Math.min(1, confidence * 1.1);
  }

  return { artHashDistance, colorDistance, confidence, fullHashDistance };
}

/**
 * Search the fingerprint index for the best visual matches.
 * @param query - The fingerprint of the scanned card image
 * @param topK - Number of top results to return (default: 5)
 * @returns Sorted array of matches, best first
 */
export async function findBestVisualMatch(
  query: { artHash: string; fullHash: string; histogram: number[]; titleHash: string },
  topK = 5,
): Promise<VisualMatchResult[]> {
  const entries = await loadIndex();

  const scored: VisualMatchResult[] = entries.map((entry) => ({
    ...scoreEntry(query, entry),
    entry,
  }));

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, topK);
}
