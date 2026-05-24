import type { VercelRequest, VercelResponse } from '@vercel/node';
import Busboy from 'busboy';

import { findPrintings } from '../../src/visual/localPrintingLookup';
import { rankCandidatePrintings } from '../../src/visual/printingMatcher';

type UploadPayload = {
  cropHeight?: number;
  cropWidth?: number;
  cropX?: number;
  cropY?: number;
  name?: string;
  oracleId?: string;
  photoBuffer?: Buffer;
};

const normalize = (value?: string) =>
  (value ?? '')
    .toLowerCase()
    .replace(/[\u2019’']/g, "'")
    .normalize('NFKC')
    .trim();

function firstFaceImage(card: any, key: 'art_crop' | 'normal') {
  return card?.card_faces?.find((face: any) => face?.image_uris?.[key])?.image_uris?.[key];
}

async function fetchPrints({ oracleId, name }: { name?: string; oracleId?: string }) {
  if (!oracleId && !name) {
    throw new Error('Missing oracleId or name for visual match.');
  }

  const localResults = await findPrintings({ name, oracleId });
  
  if (localResults.length > 0) {
    return localResults;
  }

  console.warn(`⚠️ No local printings found for oracleId=${oracleId}, name="${name}". Falling back to Scryfall API.`);
  
  const query = oracleId
    ? `oracle_id:${oracleId} unique:prints`
    : name
      ? `!"${name}" unique:prints`
      : null;

  if (!query) {
    throw new Error('Missing oracleId or name for visual match.');
  }

  const response = await fetch(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}`,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch printings from Scryfall: ${text}`);
  }

  const data = (await response.json()) as { data?: any[] };
  return (data.data ?? []).filter((card) => card?.id);
}

function parseMultipartForm(req: VercelRequest) {
  return new Promise<UploadPayload>((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    const payload: UploadPayload = {};
    const chunks: Buffer[] = [];

    busboy.on('file', (_fieldName: string, file: NodeJS.ReadableStream) => {
      file.on('data', (chunk: Buffer) => chunks.push(chunk));
      file.on('limit', () => reject(new Error('Uploaded image is too large.')));
    });

    busboy.on('field', (fieldName: string, value: string) => {
      switch (fieldName) {
        case 'cropHeight':
          payload.cropHeight = Number(value);
          break;
        case 'cropWidth':
          payload.cropWidth = Number(value);
          break;
        case 'cropX':
          payload.cropX = Number(value);
          break;
        case 'cropY':
          payload.cropY = Number(value);
          break;
        case 'name':
          payload.name = value;
          break;
        case 'oracleId':
          payload.oracleId = value;
          break;
        default:
          break;
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

    const oracleId = payload.oracleId?.trim();
    const name = payload.name?.trim();
    if (!oracleId && !name) {
      return res.status(400).json({ error: 'Missing oracleId or name.' });
    }

    const printings = await fetchPrints({ name, oracleId });
    const ranked = await rankCandidatePrintings(
      payload.photoBuffer,
      printings.map((card) => ({
        artImageUrl:
          card?.image_uris?.art_crop ??
          firstFaceImage(card, 'art_crop'),
        card,
        fullImageUrl:
          card?.image_uris?.normal ??
          firstFaceImage(card, 'normal'),
      })),
      {
        height: payload.cropHeight ?? 1,
        width: payload.cropWidth ?? 1,
        x: payload.cropX ?? 0,
        y: payload.cropY ?? 0,
      },
    );

    const matches = ranked.slice(0, 5).map((entry) => ({
      artHashDistance: entry.artHashDistance,
      card: entry.card,
      colorDistance: Number(entry.colorDistance.toFixed(4)),
      confidence: Number(entry.confidence.toFixed(4)),
      distance: Number(entry.distance.toFixed(4)),
      fullHashDistance: entry.fullHashDistance,
    }));

    const bestMatch = matches[0]?.card;
    const expectedName = normalize(name || bestMatch?.name);
    const bestName = normalize(bestMatch?.name);

    return res.status(200).json({
      bestMatch,
      matches,
      meta: {
        expectedName,
        matchedExpectedName: !!expectedName && expectedName === bestName,
        printingsCompared: printings.length,
      },
    });
  } catch (error: any) {
    console.error('💥 ERROR in /api/cards/visual-match:', error?.message, error?.stack);
    return res
      .status(500)
      .json({ error: 'Internal Server Error', details: error?.message ?? String(error) });
  }
}
