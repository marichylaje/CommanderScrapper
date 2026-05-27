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

export async function computePHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .rotate()
    .greyscale()
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Array.from(data, (value) => value);
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
