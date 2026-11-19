import sharp from 'sharp';
import { computePHash } from './phash.js';

async function normalizeCard(normalBuffer: Buffer) {
  return sharp(normalBuffer).rotate().removeAlpha()
    .resize(320, 448, { fit: 'fill' }).png().toBuffer();
}

async function regionHash(normalized: Buffer, left: number, top: number, width: number, height: number) {
  const region = await sharp(normalized).extract({ left, top, width, height }).png().toBuffer();
  return computePHash(region);
}

export async function cardRegionHashes(normalBuffer: Buffer) {
  const normalized = await normalizeCard(normalBuffer);
  return {
    phashAlt: await computePHash(normalized),
    phashCenter: await regionHash(normalized, 38, 81, 243, 260),
  };
}

export async function cameraRegionHashes(cardBuffer: Buffer) {
  const normalized = await normalizeCard(cardBuffer);
  return {
    art: await regionHash(normalized, 16, 40, 288, 215),
    artWide: await regionHash(normalized, 26, 31, 269, 287),
    full: await computePHash(normalized),
    center: await regionHash(normalized, 38, 81, 243, 260),
  };
}
