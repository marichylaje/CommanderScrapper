import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { cardRegionHashes } from './cardRegionHashes.js';
import { computePHash, preprocessGray } from './phash.js';
import { regionDistance } from './regionDistance.js';

test('preprocessing matches a clamped 3x3 convolution rounded once and clipped at [51,972]', () => {
  const input = Uint8Array.from({ length: 1024 }, (_, i) => (i * 13 + (i % 32) ** 2 + (i >> 5) ** 2) % 256);
  const clamp = (n: number) => Math.min(31, Math.max(0, n));
  const blur = Array.from(input, (_, i) => {
    let sum = 0;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      sum += (x ? 1 : 2) * (y ? 1 : 2) * input[clamp((i >> 5) + y) * 32 + clamp((i % 32) + x)];
    }
    return Math.floor((sum + 8) / 16);
  });
  const sorted = [...blur].sort((a, b) => a - b);
  assert.deepEqual(preprocessGray(input), blur.map(v => Math.max(sorted[51], Math.min(v, sorted[972]))));
});

test('benchmark rounds the best three corresponding region distances, not the minimum', () => {
  const h = (n: number) => ((1n << BigInt(n)) - 1n).toString(16).padStart(16, '0');
  const query = { phash: h(0), phashAlt: h(0), phashCenter: h(0), phashLeft: h(0), phashRight: h(0) };
  const candidate = { phash: h(60), phashAlt: h(3), phashCenter: h(2), phashLeft: h(0), phashRight: h(50) };
  assert.equal(regionDistance(query, candidate), 2);
  assert.equal(regionDistance(query, { ...candidate, phashAlt: h(2) }), 1);
});

function distance(a: string, b: string) {
  let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (value) { count += Number(value & 1n); value >>= 1n; }
  return count;
}

for (const [label, seed] of [['full-art', 7], ['planeswalker', 23], ['secret-lair', 41]] as const) {
  test(`center region matches normalized ${label} synthetic card and ignores outer frame`, async () => {
    const raw = Buffer.alloc(320 * 448 * 3);
    for (let y = 0; y < 448; y++) {
      for (let x = 0; x < 320; x++) {
        const index = (y * 320 + x) * 3;
        const value = (x * seed + y * (seed + 11) + (x * y % 113)) % 256;
        raw[index] = value;
        raw[index + 1] = (value + x) % 256;
        raw[index + 2] = (value + y) % 256;
      }
    }
    const input = await sharp(raw, { raw: { width: 320, height: 448, channels: 3 } }).png().toBuffer();
    const reference = await cardRegionHashes(input);
    const center = await sharp(input).extract({ left: 38, top: 81, width: 243, height: 260 }).png().toBuffer();
    assert.equal(reference.phashCenter, await computePHash(center));
    for (const [field, left, top, width, height] of [
      ['phash', 16, 40, 288, 215], ['phashLeft', 32, 90, 128, 180], ['phashRight', 160, 90, 128, 180],
    ] as const) {
      assert.equal(reference[field], await computePHash(await sharp(input).extract({ left, top, width, height }).png().toBuffer()));
    }
    assert.equal(reference.phashAlt, await computePHash(input));

    const frameChanged = Buffer.from(raw);
    for (let y = 0; y < 448; y++) {
      for (let x = 0; x < 320; x++) {
        if (x >= 38 && x < 281 && y >= 81 && y < 341) continue;
        const i = (y * 320 + x) * 3;
        frameChanged[i] = 255 - frameChanged[i]!;
        frameChanged[i + 1] = 255 - frameChanged[i + 1]!;
        frameChanged[i + 2] = 255 - frameChanged[i + 2]!;
      }
    }
    const changed = await sharp(frameChanged, { raw: { width: 320, height: 448, channels: 3 } }).png().toBuffer();
    const hashes = await cardRegionHashes(changed);
    assert.equal(distance(reference.phashCenter, hashes.phashCenter), 0);
    assert.ok(distance(reference.phashAlt, hashes.phashAlt) > 0);
  });
}
