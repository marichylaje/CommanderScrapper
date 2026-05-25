/**
 * api/cards/visual-match-direct.ts
 *
 * POST /api/cards/visual-match-direct
 *
 * Pure visual card matching without requiring a card name or oracle ID.
 * Uses a pre-computed fingerprint index for fast nearest-neighbor search.
 *
 * Run `npx tsx src/buildFingerprintIndex.ts` to generate data/fingerprint-index.json
 * before deploying.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Busboy from 'busboy';

import { findCardById } from '../../src/visual/localPrintingLookup';
import { buildFingerprintFromBuffer } from '../../src/visual/printingMatcher';
import { findBestVisualMatch } from '../../src/visual/fingerprintIndex';

const MIN_CONFIDENCE = 0.4;
const TOP_K = 5;

type UploadPayload = {
  cropHeight?: number;
  cropWidth?: number;
  cropX?: number;
  cropY?: number;
  photoBuffer?: Buffer;
};

function parseMultipartForm(req: VercelRequest): Promise<UploadPayload> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    const payload: UploadPayload = {};
    const chunks: Buffer[] = [];

    busboy.on('file', (_fieldName: string, file: NodeJS.ReadableStream) => {
      file.on('data', (chunk: Buffer) => chunks.push(chunk));
      file.on('limit', () => reject(new Error('Uploaded image is too large.')));
    });

    busboy.on('field', (fieldName: string, value: string) => {
      switch (fieldName) {
        case 'cropHeight': payload.cropHeight = Number(value); break;
        case 'cropWidth':  payload.cropWidth  = Number(value); break;
        case 'cropX':      payload.cropX      = Number(value); break;
        case 'cropY':      payload.cropY      = Number(value); break;
        default: break;
      }
    });

    busboy.on('error', reject);
    busboy.on('finish', () => {
      payload.photoBuffer = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      resolve(payload);
    });

    req.pipe(busboy);
  });
}

export const config = {
  api: {
    bodyParser: false,
    // 4MB max body for camera snapshots
    sizeLimit: '4mb',
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const payload = await parseMultipartForm(req);

    if (!payload.photoBuffer) {
      return res.status(400).json({ error: 'Missing uploaded photo.' });
    }

    const crop = {
      height: payload.cropHeight ?? 1,
      width: payload.cropWidth ?? 1,
      x: payload.cropX ?? 0,
      y: payload.cropY ?? 0,
    };

    // Compute fingerprint of the uploaded image
    const fingerprint = await buildFingerprintFromBuffer(payload.photoBuffer, crop);

    // Find nearest neighbors in the pre-computed index
    const topMatches = await findBestVisualMatch(fingerprint, TOP_K);

    if (topMatches.length === 0 || (topMatches[0]?.confidence ?? 0) < MIN_CONFIDENCE) {
      return res.status(200).json({
        bestMatch: null,
        matches: [],
        meta: { confidence: topMatches[0]?.confidence ?? 0, reason: 'below_threshold' },
      });
    }

    // Enrich top matches with full card data from the local dataset
    const enrichedMatches = await Promise.all(
      topMatches.map(async (match) => {
        const card = await findCardById(match.entry.id);
        return {
          artHashDistance: match.artHashDistance,
          card: card ?? match.entry,
          colorDistance: Number(match.colorDistance.toFixed(4)),
          confidence: Number(match.confidence.toFixed(4)),
          fullHashDistance: match.fullHashDistance,
        };
      }),
    );

    const best = enrichedMatches[0]!;

    return res.status(200).json({
      bestMatch: best.card,
      confidence: best.confidence,
      matches: enrichedMatches,
      meta: {
        topConfidence: best.confidence,
        totalIndexed: topMatches.length,
      },
    });
  } catch (error: any) {
    console.error('💥 ERROR in /api/cards/visual-match-direct:', error?.message, error?.stack);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: error?.message ?? String(error),
    });
  }
}
