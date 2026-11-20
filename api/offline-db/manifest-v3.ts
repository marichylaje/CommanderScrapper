import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, handleCorsPreflight } from '../_lib/cors.js';
import { ENTRY_VERSION, hasV3Hashes } from '../../src/offline/contract.js';

const latest = 'https://x1nmivzmtxfyked6.public.blob.vercel-storage.com/offline-db/latest-v3.json';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Only GET allowed' });
  // An explicit pin is authoritative, including during rollout/rollback.
  const url = process.env.OFFLINE_DB_MANIFEST_V3_URL || process.env.OFFLINE_DB_LATEST_V3_URL || latest;
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (response.ok) {
      const m = await response.json() as {
        schema?: number; version?: string; generator?: { entry_version?: number; crop_hashes?: unknown };
        buckets?: Record<string, { url?: string }>;
      };
      if (m?.schema === 3 && typeof m.version === 'string' && m.version &&
          m.generator?.entry_version === ENTRY_VERSION && hasV3Hashes(m.generator.crop_hashes) &&
          Object.keys(m.buckets ?? {}).length === 7 &&
          ['W', 'U', 'B', 'R', 'G', 'C', 'M'].every((k) => m.buckets?.[k]?.url?.startsWith('https://'))) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.status(200).json(m);
      }
    }
  } catch {
    // Never fall back to a legacy alias or a local manifest without hosted buckets.
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(503).json({ error: 'V3 catalog unavailable' });
}
