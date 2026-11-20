import sharp from 'sharp';
import { computePHash } from './phash.js';
import type { RegionHashes } from './contract.js';

export async function cardRegionHashes(fullCard: Buffer): Promise<RegionHashes> {
  const { data, info } = await sharp(fullCard).rotate().removeAlpha().toColourspace('srgb')
    .resize(320, 448, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const image = () => sharp(data, { raw: info });
  const region = (left: number, top: number, width: number, height: number) =>
    computePHash(image().extract({ left, top, width, height }));
  const [phash, phashAlt, phashCenter, phashLeft, phashRight] = await Promise.all([
    region(16, 40, 288, 215), computePHash(image()), region(38, 81, 243, 260),
    region(32, 90, 128, 180), region(160, 90, 128, 180),
  ]);
  return { phash, phashAlt, phashCenter, phashLeft, phashRight };
}
