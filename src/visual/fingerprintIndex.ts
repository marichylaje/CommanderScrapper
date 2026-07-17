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
  const hasTitle =
    Boolean(candidate.titleHash && query.titleHash) &&
    candidate.titleHash!.length === query.titleHash.length;
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

  const ambiguousVisuals = normalizedArt >= 0.08 || colorDistance >= 0.35;
  let titleWeight = 0;
  if (hasTitle && normalizedArt >= 0.05) {
    if (normalizedTitle < 0.25 && ambiguousVisuals) {
      titleWeight = 0.2;
    } else {
      titleWeight = normalizedArt < 0.15 ? 0.14 : 0.1;
    }
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

// ── OCR-Aware Search ──────────────────────────────────────────────────────────

type SearchIndices = {
  byNameKey: Map<string, FingerprintEntry[]>;
  bySetCn: Map<string, FingerprintEntry[]>;
  entries: FingerprintEntry[];
};

let searchIndices: SearchIndices | null = null;

function normalizeKey(value?: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function buildSearchIndices(entries: FingerprintEntry[]): SearchIndices {
  const byNameKey = new Map<string, FingerprintEntry[]>();
  const bySetCn = new Map<string, FingerprintEntry[]>();

  for (const entry of entries) {
    const nk = normalizeKey(entry.name);
    if (nk) {
      const arr = byNameKey.get(nk) ?? [];
      arr.push(entry);
      byNameKey.set(nk, arr);
    }
    const s = normalizeKey(entry.set);
    const c = normalizeKey(entry.cn);
    if (s && c) {
      const key = `${s}|${c}`;
      const arr = bySetCn.get(key) ?? [];
      arr.push(entry);
      bySetCn.set(key, arr);
    }
  }

  console.log(
    `📑 Built search indices: ${byNameKey.size} name keys, ${bySetCn.size} set+cn pairs`,
  );
  return { byNameKey, bySetCn, entries };
}

export type OcrHint = {
  collectorNumber?: string;
  name?: string;
  setCode?: string;
};

/**
 * Advanced visual search with OCR pre-filtering and optional oracle ID restriction.
 *
 * - If `oracleIds` is provided, restricts the search to those oracle IDs only.
 *   This is the reranking mode: mobile finds top-K oracle IDs offline (64-bit pHash),
 *   server re-scores them with 256-bit dHash for higher precision.
 *
 * - If `ocr` is provided, pre-filters by set+cn or name before computing Hamming
 *   distances — reduces O(70K) to O(10–200) for most queries, dramatically
 *   improving both speed and accuracy.
 */
export async function findBestVisualMatchAdvanced(
  query: { artHash: string; fullHash: string; histogram: number[]; titleHash: string },
  topK = 5,
  ocr?: OcrHint | null,
  oracleIds?: string[] | null,
): Promise<VisualMatchResult[]> {
  const entries = await loadIndex();

  // Rebuild indices if the index has been reloaded
  if (!searchIndices || searchIndices.entries !== entries) {
    searchIndices = buildSearchIndices(entries);
  }

  const { byNameKey, bySetCn } = searchIndices;

  // Stage 1: Oracle restriction (reranking mode — restrict to known oracle IDs)
  let candidates: FingerprintEntry[] =
    oracleIds && oracleIds.length > 0
      ? entries.filter((e) => oracleIds.includes(e.oracle_id))
      : entries;

  // Stage 2: OCR pre-filter within candidate pool
  let ocrPool: FingerprintEntry[] | null = null;

  if (ocr) {
    const s = normalizeKey(ocr.setCode);
    const c = normalizeKey(ocr.collectorNumber);
    const n = normalizeKey(ocr.name);

    if (s && c) {
      const exact = bySetCn.get(`${s}|${c}`) ?? [];
      if (exact.length > 0) {
        ocrPool = oracleIds?.length
          ? exact.filter((e) => oracleIds.includes(e.oracle_id))
          : exact;
      }
    }

    if (!ocrPool && n.length >= 3) {
      const byName = byNameKey.get(n) ?? [];
      if (byName.length > 0 && byName.length <= 300) {
        ocrPool = oracleIds?.length
          ? byName.filter((e) => oracleIds.includes(e.oracle_id))
          : byName;
      }
    }
  }

  // Use OCR-narrowed pool when it meaningfully reduces the search space
  const pool =
    ocrPool && ocrPool.length > 0 && ocrPool.length <= 200
      ? ocrPool
      : candidates;

  const scored: VisualMatchResult[] = pool.map((entry) => ({
    ...scoreEntry(query, entry),
    entry,
  }));

  scored.sort((a, b) => b.confidence - a.confidence);

  // If the OCR-filtered pool gave weak results, fall back to full candidate set
  if (
    ocrPool &&
    pool === ocrPool &&
    (scored[0]?.confidence ?? 0) < 0.45 &&
    candidates.length > ocrPool.length
  ) {
    const fallback: VisualMatchResult[] = candidates.map((entry) => ({
      ...scoreEntry(query, entry),
      entry,
    }));
    fallback.sort((a, b) => b.confidence - a.confidence);
    return fallback.slice(0, topK);
  }

  return scored.slice(0, topK);
}
