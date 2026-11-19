import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';

import { decodeOfflineDb, encodeOfflineDb, type OfflineEntry } from './binaryDb.js';
import { BUCKETS, createBucketInfo, validateCatalog } from './offlineManifest.js';

const printing: OfflineEntry = {
  id: 'printing-ja', oracle_id: 'oracle-1', name: '稲妻', set: 'mh3',
  cn: '0142a', lang: 'ja', artUrl: 'https://example.com/art.jpg',
  phash: 'fedcba9876543210', phashAlt: '89abcdef01234567',
};

test('emits the exact app wire layout, including UTF-8 bytes and both unsigned hash halves', () => {
  const { buffer } = encodeOfflineDb([printing]);
  assert.equal(buffer.subarray(0, 6).toString(), 'TCGDB1');
  assert.equal(buffer.subarray(6, 24).toString('hex'), '020001000000070000001800000044000000');
  assert.deepEqual(Array.from({ length: 7 }, (_, index) => buffer.readUInt32LE(24 + index * 4)), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(buffer.subarray(52, 68).toString('hex'), '98badcfe10325476efcdab8967452301');
  const nameLength = 68 + 2 + printing.id.length + 2 + printing.oracle_id.length;
  assert.equal(buffer.readUInt16LE(nameLength), Buffer.byteLength(printing.name));
  assert.deepEqual(decodeOfflineDb(buffer).entries, [printing]);
});

test('reads an existing DeckBuilder v1 bucket and emits v2 even for an empty bucket', async () => {
  const legacy = gunzipSync(await readFile(join('data', 'offline', 'cards-W.bin.gz')));
  const { version, entries } = decodeOfflineDb(legacy);
  assert.equal(version, 1);
  assert.ok(entries.length > 1000);
  assert.deepEqual(entries[0], {
    id: '540f3ddf-7512-42a0-ba22-b58453747346', oracle_id: '8ae3562f-28b7-4462-96ed-be0cf7052ccc',
    name: 'Kor Outfitter', set: 'gn3', cn: '14', lang: 'en',
    artUrl: 'https://cards.scryfall.io/art_crop/front/5/4/540f3ddf-7512-42a0-ba22-b58453747346.jpg?1673301333',
    phash: 'cdf9220c3871e69c', phashAlt: 'cdf9220c3871e69c',
  });
  assert.deepEqual(decodeOfflineDb(encodeOfflineDb([]).buffer), { version: 2, entries: [] });
  assert.equal(decodeOfflineDb(encodeOfflineDb([{ ...printing, phashAlt: undefined }]).buffer).entries[0]?.phashAlt, printing.phash);
});

test('rejects legacy 16-byte offsets, invalid indexes, truncation and missing identity', () => {
  const { buffer } = encodeOfflineDb([printing]);
  const former = Buffer.from(buffer);
  former.writeUInt32LE(16, 16);
  assert.throws(() => decodeOfflineDb(former), /offsets/);
  const invalidIndex = Buffer.from(buffer);
  invalidIndex.writeUInt32LE(42, 24);
  assert.throws(() => decodeOfflineDb(invalidIndex), /string index/);
  assert.throws(() => decodeOfflineDb(buffer.subarray(0, -1)), /Truncated/);
  assert.throws(() => encodeOfflineDb([{ ...printing, lang: '' }]), /lang/);
});

test('validates all seven manifest buckets and rejects mismatched bytes or counts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tcgdb-validation-'));
  try {
    const manifestPath = join(dir, 'manifest.v2.json');
    const buckets = Object.fromEntries(await Promise.all(BUCKETS.map(async (bucket) => {
      const entries = bucket === 'W' ? [printing] : [];
      const bytes = gzipSync(encodeOfflineDb(entries).buffer);
      const file = `cards-${bucket}.bin.gz`;
      await writeFile(join(dir, file), bytes);
      return [bucket, createBucketInfo(file, entries.length, bytes)] as const;
    })));
    const manifest = {
      schema: 2, version: 'test-v2', generated_at: '2026-11-19T13:00:00.000Z',
      source_updated: '2026-11-19T12:00:00.000Z', generator: { entry_version: 2 }, buckets,
    };
    const save = () => writeFile(manifestPath, JSON.stringify(manifest));
    await save();
    assert.deepEqual((await validateCatalog(manifestPath, 'test-v2')).languages, ['ja']);
    await assert.rejects(validateCatalog(manifestPath, 'unexpected'), /Expected catalog/);
    buckets.W.count = 2;
    await save();
    await assert.rejects(validateCatalog(manifestPath), /entry count/);
    buckets.W.count = 1;
    await save();
    await writeFile(join(dir, buckets.W.file), 'corrupt');
    await assert.rejects(validateCatalog(manifestPath), /SHA-256 mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
