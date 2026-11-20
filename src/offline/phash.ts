import sharp from 'sharp';

const HASH_SIZE = 32;
const SMALL_SIZE = 8;

function buildCosineTable(size: number) {
  const table: number[][] = Array.from({ length: size }, () =>
    new Array(size).fill(0),
  );
  const factor = Math.PI / (2 * size);
  for (let u = 0; u < size; u += 1) {
    for (let x = 0; x < size; x += 1) {
      table[u]![x] = Math.cos((2 * x + 1) * u * factor);
    }
  }
  return table;
}

const COS_TABLE = buildCosineTable(HASH_SIZE);

function dct2d(values: number[], size: number, smallSize: number) {
  const result: number[][] = Array.from({ length: smallSize }, () =>
    new Array(smallSize).fill(0),
  );
  const alpha = (i: number) =>
    i === 0 ? 1 / Math.sqrt(size) : Math.sqrt(2 / size);

  for (let u = 0; u < smallSize; u += 1) {
    for (let v = 0; v < smallSize; v += 1) {
      let sum = 0;
      for (let x = 0; x < size; x += 1) {
        for (let y = 0; y < size; y += 1) {
          const pixel = values[y * size + x] ?? 0;
          sum += pixel * COS_TABLE[u]![x] * COS_TABLE[v]![y];
        }
      }
      result[u]![v] = alpha(u) * alpha(v) * sum;
    }
  }
  return result;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid] ?? 0;
}

export function preprocessGray(data: Uint8Array) {
  if (data.length !== HASH_SIZE ** 2) throw new Error('Expected 32x32 grayscale pixels');
  const horizontal = new Uint16Array(data.length);
  const blurred = new Array<number>(data.length);
  const last = HASH_SIZE - 1;
  for (let y = 0; y <= last; y++) {
    for (let x = 0; x <= last; x++) {
      const i = y * HASH_SIZE + x;
      horizontal[i] = data[x ? i - 1 : i] + 2 * data[i] + data[x < last ? i + 1 : i];
    }
  }
  for (let i = 0; i < data.length; i++) {
    blurred[i] = Math.round((horizontal[i < HASH_SIZE ? i : i - HASH_SIZE] + 2 * horizontal[i] +
      horizontal[i < last * HASH_SIZE ? i + HASH_SIZE : i]) / 16);
  }
  const sorted = [...blurred].sort((a, b) => a - b);
  return blurred.map((v) => Math.min(sorted[972], Math.max(sorted[51], v)));
}

export async function computePHash(source: Buffer | sharp.Sharp): Promise<string> {
  const image = Buffer.isBuffer(source) ? sharp(source).rotate() : source;
  const { data } = await image.removeAlpha()
    .greyscale()
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = preprocessGray(data);
  const dct = dct2d(pixels, HASH_SIZE, SMALL_SIZE);

  const coefficients: number[] = [];
  for (let u = 0; u < SMALL_SIZE; u += 1) {
    for (let v = 0; v < SMALL_SIZE; v += 1) {
      coefficients.push(dct[u]![v] ?? 0);
    }
  }

  const threshold = median(coefficients);
  let bits = '';
  for (const value of coefficients) {
    bits += value > threshold ? '1' : '0';
  }

  let hash = '';
  for (let i = 0; i < bits.length; i += 4) {
    hash += Number.parseInt(bits.slice(i, i + 4), 2).toString(16);
  }

  return hash.padStart(16, '0');
}
