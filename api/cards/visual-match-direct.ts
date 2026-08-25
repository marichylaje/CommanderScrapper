import { applyCors, handleCorsPreflight } from '../_lib/cors.js';
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

import { findCardById } from '../../src/visual/localPrintingLookup.js';
import { buildFingerprintFromBuffer } from '../../src/visual/printingMatcher.js';
import {
  findBestVisualMatchAdvanced,
  type OcrHint,
} from '../../src/visual/fingerprintIndex.js';

const MIN_CONFIDENCE = 0.4;
const TOP_K = 5;

type UploadPayload = {
  cropHeight?: number;
  cropWidth?: number;
  cropX?: number;
  cropY?: number;
  ocrCn?: string;
  ocrName?: string;
  ocrSet?: string;
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
        case 'ocrName':    payload.ocrName    = value;         break;
        case 'ocrSet':     payload.ocrSet     = value;         break;
        case 'ocrCn':      payload.ocrCn      = value;         break;
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

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export const config = {
  api: {
    bodyParser: false,
    // 4MB max body for camera snapshots
    sizeLimit: '4mb',
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const requestId =
    headerValue(req.headers['x-vercel-id']) ||
    headerValue(req.headers['x-request-id']) ||
    'unknown';

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

    console.log('ðŸ“· visual-match-direct: request', {
      requestId,
      crop,
      bytes: payload.photoBuffer.length,
    });

    // Compute fingerprint of the uploaded image
    const fingerprint = await buildFingerprintFromBuffer(payload.photoBuffer, crop);

    console.log('ðŸ§¬ visual-match-direct: fingerprint', {
      requestId,
      artHash: fingerprint.artHash.slice(0, 8),
      fullHash: fingerprint.fullHash.slice(0, 8),
      histogramSize: fingerprint.histogram.length,
    });

    // Build OCR hint from form fields â€” pre-filters index before Hamming scan
    const ocr: OcrHint | null = (payload.ocrName || payload.ocrSet || payload.ocrCn)
      ? {
          collectorNumber: payload.ocrCn,
          name: payload.ocrName,
          setCode: payload.ocrSet,
        }
      : null;

    if (ocr) {
      console.log('ðŸ”¤ visual-match-direct: ocr hint', { requestId, ocr });
    }

    // Find nearest neighbors â€” OCR pre-filtering reduces O(70K) to O(10â€“200)
    const topMatches = await findBestVisualMatchAdvanced(fingerprint, TOP_K, ocr);

    const matchSummary = topMatches.slice(0, 3).map((match) => ({
      id: match.entry.id,
      name: match.entry.name,
      set: match.entry.set,
      confidence: Number(match.confidence.toFixed(4)),
      artHashDistance: match.artHashDistance,
      fullHashDistance: match.fullHashDistance,
      colorDistance: Number(match.colorDistance.toFixed(4)),
    }));

    console.log('ðŸŽ¯ visual-match-direct: matches', {
      requestId,
      total: topMatches.length,
      top: matchSummary,
    });

    if (topMatches.length === 0 || (topMatches[0]?.confidence ?? 0) < MIN_CONFIDENCE) {
      return res.status(200).json({
        bestMatch: null,
        matches: [],
        meta: { confidence: topMatches[0]?.confidence ?? 0, reason: 'below_threshold' },
      });
    }

    // Enrich top matches with full card data from the dataset (graceful fallback to entry data)
    const enrichedMatches = await Promise.all(
      topMatches.map(async (match) => {
        let card: object = match.entry;
        try {
          const found = await findCardById(match.entry.id);
          if (found) card = found;
        } catch {
          // Dataset unavailable â€” use fingerprint entry data as fallback
        }
        return {
          artHashDistance: match.artHashDistance,
          card,
          colorDistance: Number(match.colorDistance.toFixed(4)),
          confidence: Number(match.confidence.toFixed(4)),
          fullHashDistance: match.fullHashDistance,
        };
      }),
    );

    const best = enrichedMatches[0]!;
    const secondBest = enrichedMatches.find(
      (m) => (m.card as any).oracle_id !== (best.card as any).oracle_id,
    );

    return res.status(200).json({
      bestMatch: best.card,
      confidence: best.confidence,
      matches: enrichedMatches,
      meta: {
        ocrContribution: Boolean(ocr),
        secondBestConfidence: secondBest?.confidence ?? 0,
        topConfidence: best.confidence,
        totalIndexed: topMatches.length,
      },
    });
  } catch (error: any) {
    console.error('ðŸ’¥ ERROR in /api/cards/visual-match-direct:', requestId, error?.message, error?.stack);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: error?.message ?? String(error),
    });
  }
}



