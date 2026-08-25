import { applyCors, handleCorsPreflight } from '../_lib/cors.js';
/**
 * api/cards/visual-rerank.ts
 *
 * POST /api/cards/visual-rerank
 *
 * Professional reranking endpoint for ambiguous scan cases.
 *
 * Designed as the second stage of a hybrid offline/online pipeline:
 *   1. Mobile matches offline via 64-bit pHash â†’ top-K oracle IDs
 *   2. Mobile uploads image + oracle IDs + accumulated OCR to this endpoint
 *   3. Server re-scores using 256-bit dHash (4Ã— more discriminating) and OCR filtering
 *   4. Returns ranked candidates with full confidence breakdown
 *
 * Input (multipart/form-data):
 *   - photo:       image file (JPEG)
 *   - cropX/Y/Width/Height: normalized crop region (0â€“1)
 *   - ocrName:     accumulated OCR card name (optional)
 *   - ocrSet:      accumulated OCR set code (optional)
 *   - ocrCn:       accumulated OCR collector number (optional)
 *   - oracleIds:   comma-separated oracle IDs from offline match (optional)
 *
 * Output:
 *   {
 *     bestMatch: ScryfallCard | null,
 *     confidence: number,
 *     matches: [{ card, confidence, artHashDistance, fullHashDistance, colorDistance }],
 *     meta: { stage, ambiguous, ocrContribution, topConfidence, secondBestConfidence }
 *   }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Busboy from 'busboy';

import { findCardById } from '../../src/visual/localPrintingLookup.js';
import { buildFingerprintFromBuffer } from '../../src/visual/printingMatcher.js';
import {
  findBestVisualMatchAdvanced,
  type OcrHint,
} from '../../src/visual/fingerprintIndex.js';

const MIN_CONFIDENCE = 0.35;
const TOP_K = 8;

type UploadPayload = {
  cropHeight?: number;
  cropWidth?: number;
  cropX?: number;
  cropY?: number;
  ocrCn?: string;
  ocrName?: string;
  ocrSet?: string;
  oracleIds?: string;
  photoBuffer?: Buffer;
};

function parseMultipartForm(req: VercelRequest): Promise<UploadPayload> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    const payload: UploadPayload = {};
    const chunks: Buffer[] = [];

    busboy.on('file', (_: string, file: NodeJS.ReadableStream) => {
      file.on('data', (chunk: Buffer) => chunks.push(chunk));
      file.on('limit', () => reject(new Error('Uploaded image is too large.')));
    });

    busboy.on('field', (name: string, value: string) => {
      switch (name) {
        case 'cropHeight':  payload.cropHeight = Number(value); break;
        case 'cropWidth':   payload.cropWidth  = Number(value); break;
        case 'cropX':       payload.cropX      = Number(value); break;
        case 'cropY':       payload.cropY      = Number(value); break;
        case 'ocrName':     payload.ocrName    = value;         break;
        case 'ocrSet':      payload.ocrSet     = value;         break;
        case 'ocrCn':       payload.ocrCn      = value;         break;
        case 'oracleIds':   payload.oracleIds  = value;         break;
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
  api: { bodyParser: false, sizeLimit: '4mb' },
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

    const oracleIds: string[] | null = payload.oracleIds
      ? payload.oracleIds.split(',').map((s) => s.trim()).filter(Boolean)
      : null;

    const ocr: OcrHint | null = (payload.ocrName || payload.ocrSet || payload.ocrCn)
      ? {
          collectorNumber: payload.ocrCn,
          name: payload.ocrName,
          setCode: payload.ocrSet,
        }
      : null;

    const stage = oracleIds?.length ? 'rerank' : 'global';

    console.log('ðŸ”€ visual-rerank: request', {
      requestId,
      crop,
      oracleIdCount: oracleIds?.length ?? 0,
      hasOcr: Boolean(ocr),
      bytes: payload.photoBuffer.length,
      stage,
    });

    const fingerprint = await buildFingerprintFromBuffer(payload.photoBuffer, crop);

    console.log('ðŸ§¬ visual-rerank: fingerprint', {
      requestId,
      artHash: fingerprint.artHash.slice(0, 8),
      fullHash: fingerprint.fullHash.slice(0, 8),
    });

    const topMatches = await findBestVisualMatchAdvanced(
      fingerprint,
      TOP_K,
      ocr,
      oracleIds,
    );

    const matchSummary = topMatches.slice(0, 3).map((m) => ({
      id: m.entry.id,
      name: m.entry.name,
      set: m.entry.set,
      confidence: Number(m.confidence.toFixed(4)),
      artHashDistance: m.artHashDistance,
    }));

    console.log('ðŸŽ¯ visual-rerank: matches', {
      requestId,
      total: topMatches.length,
      stage,
      top: matchSummary,
    });

    if (topMatches.length === 0 || (topMatches[0]?.confidence ?? 0) < MIN_CONFIDENCE) {
      return res.status(200).json({
        bestMatch: null,
        confidence: topMatches[0]?.confidence ?? 0,
        matches: [],
        meta: {
          ambiguous: false,
          ocrContribution: Boolean(ocr),
          reason: 'below_threshold',
          secondBestConfidence: 0,
          stage,
          topConfidence: topMatches[0]?.confidence ?? 0,
        },
      });
    }

    // Enrich top matches with full card data
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

    const ambiguous =
      secondBest != null && best.confidence - secondBest.confidence < 0.05;

    return res.status(200).json({
      bestMatch: best.card,
      confidence: best.confidence,
      matches: enrichedMatches,
      meta: {
        ambiguous,
        ocrContribution: Boolean(ocr),
        secondBestConfidence: secondBest?.confidence ?? 0,
        stage,
        topConfidence: best.confidence,
      },
    });
  } catch (error: any) {
    console.error(
      'ðŸ’¥ ERROR in /api/cards/visual-rerank:',
      requestId,
      error?.message,
      error?.stack,
    );
    return res.status(500).json({
      error: 'Internal Server Error',
      details: error?.message ?? String(error),
    });
  }
}



