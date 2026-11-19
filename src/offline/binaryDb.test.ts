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
  phashCenter: '0123456789abcdef',
};

test('emits the final app wire layout with three unsigned hashes', () => {
  const { buffer } = encodeOfflineDb([printing]);
  assert.equal(buffer.subarray(0, 6).toString(), 'TCGDB1');
  assert.equal(buffer.subarray(6, 24).toString('hex'), '02000100000007000000180000004c000000');
  assert.deepEqual(Array.from({ length: 7 }, (_, index) => buffer.readUInt32LE(24 + index * 4)), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(buffer.subarray(52, 76).toString('hex'), '98badcfe10325476efcdab896745230167452301efcdab89');
  const nameLength = 76 + 2 + printing.id.length + 2 + printing.oracle_id.length;
  assert.equal(buffer.readUInt16LE(nameLength), Buffer.byteLength(printing.name));
  assert.deepEqual(decodeOfflineDb(buffer).entries, [printing]);
});

test('rejects obsolete records and emits the final format even for an empty bucket', async () => {
  const legacy = gunzipSync(await readFile(join('data', 'offline', 'cards-W.bin.gz')));
  assert.throws(() => decodeOfflineDb(legacy), /Unsupported TCGDB1 version/);
  assert.deepEqual(decodeOfflineDb(encodeOfflineDb([]).buffer), { version: 2, entries: [] });
  const current = encodeOfflineDb([printing]).buffer;
  const v2 = Buffer.concat([current.subarray(0, 68), current.subarray(76)]);
  v2.writeUInt16LE(2, 6);
  v2.writeUInt32LE(68, 20);
  assert.throws(() => decodeOfflineDb(v2), /offsets/);
  assert.throws(() => encodeOfflineDb([{ ...printing, phashCenter: undefined }]), /Missing full-card or center/);
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
      source_updated: '2026-11-19T12:00:00.000Z',
      generator: { entry_version: 2, crop_hashes: ['art_crop', 'normal', 'center_12_18_76_58'] }, buckets,
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
