import type { VercelRequest, VercelResponse } from '@vercel/node';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MANIFEST_PATH = join(process.cwd(), 'data', 'offline', 'manifest.json');
const MANIFEST_URL = process.env.OFFLINE_DB_MANIFEST_URL;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET allowed' });
  }

  try {
    if (MANIFEST_URL) {
      const response = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        const json = await response.json();
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(200).json(json);
      }
    }

    await access(MANIFEST_PATH);
    const raw = await readFile(MANIFEST_PATH, 'utf-8');
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.status(200).json(JSON.parse(raw));
  } catch (error: any) {
    console.error('💥 Failed to serve offline manifest:', error?.message);
    return res.status(500).json({ error: 'Manifest unavailable' });
  }
}
