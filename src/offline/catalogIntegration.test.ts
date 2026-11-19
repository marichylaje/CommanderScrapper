import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { decodeOfflineDb } from './binaryDb.js';
import { cardRegionHashes } from './cardRegionHashes.js';
import { validateCatalog } from './offlineManifest.js';

test('generates and validates three-region records for special printing identities', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tcgdb-regions-'));
  const raw = Buffer.alloc(320 * 448 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 13 + Math.floor(i / 960) * 29) % 256;
  const image = await sharp(raw, { raw: { width: 320, height: 448, channels: 3 } }).png().toBuffer();
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(image); });
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/card.png`;
    const cards = [
      { id: 'full-art-printing', oracle_id: 'land-oracle', name: 'Full Art', set: 'aaa', collector_number: '1' },
      { id: 'planeswalker-printing', oracle_id: 'walker-oracle', name: 'Planeswalker', set: 'bbb', collector_number: '2' },
      { id: 'secret-lair-printing', oracle_id: 'jodah-oracle', name: 'Jodah, the Unifier', set: 'sld', collector_number: '1932' },
    ].map((card) => ({ ...card, lang: 'en', colors: ['W'], image_uris: { art_crop: url, normal: url } }));
    const input = join(dir, 'input.json');
    await writeFile(input, JSON.stringify({ last_updated: '2026-01-01T00:00:00Z', cards }));
    await promisify(execFile)(process.execPath, [
      resolve('node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/offline/buildOfflineDb.ts',
      '--input', input, '--out', dir,
    ], { cwd: process.cwd(), timeout: 30000 });
    const manifestPath = join(dir, 'manifest.v2.json');
    const validated = await validateCatalog(manifestPath);
    assert.equal(validated.printingCount, 3);
    const entries = (await Promise.all(validated.verified.map(async ({ info }) =>
      decodeOfflineDb(gunzipSync(await readFile(join(dir, info.file)))).entries))).flat();
    assert.deepEqual(entries.map((entry) => entry.id).sort(), cards.map((card) => card.id).sort());
    const expected = await cardRegionHashes(image);
    for (const entry of entries) {
      assert.equal(entry.phashAlt, expected.phashAlt);
      assert.equal(entry.phashCenter, expected.phashCenter);
    }
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not publish a partial catalog when a full-card download fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tcgdb-failed-download-'));
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/missing.png`;
    const input = join(dir, 'input.json');
    await writeFile(input, JSON.stringify({
      last_updated: '2026-01-01T00:00:00Z',
      cards: [{ id: 'printing', oracle_id: 'oracle', name: 'Example', set: 'sld',
        collector_number: '1', lang: 'en', image_uris: { normal: url } }],
    }));
    await assert.rejects(promisify(execFile)(process.execPath, [
      resolve('node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/offline/buildOfflineDb.ts',
      '--input', input, '--out', dir,
    ], { cwd: process.cwd(), timeout: 30000 }), /failed to download full-card image/);
    await assert.rejects(readFile(join(dir, 'manifest.v2.json')), /ENOENT/);
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});
