import { applyCors, handleCorsPreflight } from '../_lib/cors.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MANIFEST_PATHS = [
  join(process.cwd(), 'data', 'offline', 'manifest.v2.json'),
  join(process.cwd(), 'data', 'offline', 'manifest.json'),
];
const MANIFEST_URLS = [
  process.env.OFFLINE_DB_MANIFEST_V2_URL,
  process.env.OFFLINE_DB_MANIFEST_URL,
].filter((value): value is string => Boolean(value));

function isServableManifest(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const { schema, version, buckets } = value as {
    schema?: number; version?: string; buckets?: Record<string, { url?: string }>;
  };
  return (schema === 1 || schema === 2) && typeof version === 'string' && version.length > 0 &&
    ['W', 'U', 'B', 'R', 'G', 'C', 'M'].every((key) =>
      typeof buckets?.[key]?.url === 'string' && buckets[key].url.startsWith('https://'),
    );
}

async function fetchManifest() {
  for (const manifestUrl of MANIFEST_URLS) {
    try {
      const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        continue;
      }
      const manifest: unknown = await response.json();
      if (isServableManifest(manifest)) return manifest;
      console.warn('Skipping offline manifest without downloadable buckets');
    } catch {
      // Try the next source.
    }
  }
  return null;
}

async function readLocalManifest() {
  for (const manifestPath of MANIFEST_PATHS) {
    try {
      await access(manifestPath);
      const raw = await readFile(manifestPath, 'utf-8');
      const manifest: unknown = JSON.parse(raw);
      if (isServableManifest(manifest)) return manifest;
    } catch {
      // Try the next local file.
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET allowed' });
  }

  try {
    const remoteManifest = await fetchManifest();
    if (remoteManifest) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).json(remoteManifest);
    }

    const localManifest = await readLocalManifest();
    if (localManifest) {
      res.setHeader('Cache-Control', 'public, max-age=120');
      return res.status(200).json(localManifest);
    }

    return res.status(500).json({ error: 'Manifest unavailable' });
  } catch (error: any) {
    console.error('ðŸ’¥ Failed to serve offline manifest:', error?.message);
    return res.status(500).json({ error: 'Manifest unavailable' });
  }
}


