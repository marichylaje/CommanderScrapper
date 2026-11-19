import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { cardRegionHashes } from './cardRegionHashes.js';
import { computePHash } from './phash.js';

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
