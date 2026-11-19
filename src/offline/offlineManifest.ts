import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { unzipSync } from 'node:zlib';

import { decodeOfflineDb, ENTRY_VERSION, MAX_BUCKET_BYTES } from './binaryDb.js';
import type { ColorBucket } from './colorBuckets.js';

export const BUCKETS: ColorBucket[] = ['W', 'U', 'B', 'R', 'G', 'C', 'M'];
export const LOCAL_MANIFEST = join('data', 'offline', 'manifest.v2.json');
type BucketInfo = { count: number; file: string; sha256: string; url?: string };
export type OfflineManifest = {
  schema: 2;
  version: string;
  generated_at: string;
  source_updated: string;
  generator: { crop_hashes: string[]; entry_version: number; visual_buckets: boolean };
  buckets: Partial<Record<ColorBucket, BucketInfo>>;
};

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createBucketInfo(file: string, count: number, bytes: Buffer): BucketInfo {
  return { file, count, sha256: digest(bytes) };
}

async function download(url: string) {
  if (new URL(url).protocol !== 'https:') throw new Error(`Expected HTTPS URL: ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function validateCatalog(location: string, expectedVersion?: string) {
  const remote = /^https?:\/\//i.test(location);
  const source = remote ? await download(location) : await readFile(location);
  const manifest: OfflineManifest = JSON.parse(source.toString('utf8'));
  if (manifest?.schema !== 2 || typeof manifest.version !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(manifest.version) ||
      manifest.generator?.entry_version !== ENTRY_VERSION ||
      !Number.isFinite(Date.parse(manifest.generated_at)) ||
      !Number.isFinite(Date.parse(manifest.source_updated)) ||
      !manifest.buckets || Object.keys(manifest.buckets).length !== BUCKETS.length) {
    throw new Error('Invalid v2 offline manifest');
  }
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(`Expected catalog ${expectedVersion}; endpoint returned ${manifest.version}`);
  }
  const ids = new Set<string>();
  const languages = new Set<string>();
  const files = new Set<string>();
  const verified = [];
  for (const bucket of BUCKETS) {
    const info = manifest.buckets[bucket];
    if (!info || !Number.isSafeInteger(info.count) || info.count < 0 ||
        typeof info.file !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.bin\.(gz|deflate)$/.test(info.file) ||
        !/^[a-f0-9]{64}$/.test(info.sha256) || files.has(info.file)) {
      throw new Error(`Invalid manifest metadata for bucket ${bucket}`);
    }
    files.add(info.file);
    try {
      const bytes = remote
        ? await download(info.url ?? '')
        : await readFile(join(dirname(location), info.file));
      if (digest(bytes) !== info.sha256) throw new Error('SHA-256 mismatch');
      const decoded = decodeOfflineDb(unzipSync(bytes, { maxOutputLength: MAX_BUCKET_BYTES }));
      if (decoded.version !== ENTRY_VERSION || decoded.entries.length !== info.count) {
        throw new Error('Binary version or entry count differs from manifest');
      }
      for (const entry of decoded.entries) {
        if (ids.has(entry.id)) throw new Error(`Duplicate printing ID: ${entry.id}`);
        ids.add(entry.id);
        languages.add(entry.lang);
      }
      verified.push({ bucket, info, bytes });
    } catch (error) {
      throw new Error(`Bucket ${bucket}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  if (!ids.size) throw new Error('Catalog contains no printings');
  return { manifest, verified, printingCount: ids.size, languages: [...languages].sort() };
}
