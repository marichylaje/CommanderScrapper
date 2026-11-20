import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { decodeOfflineDb } from './binaryDb.js';
import { cardRegionHashes } from './cardRegionHashes.js';
import { validateCatalog } from './offlineManifest.js';

test('streams alternate paper prints, preserves languages and reuses cached v3 hashes', async () => {
  const dir = join(process.cwd(), `tcgdb-regions-${randomUUID()}`);
  await mkdir(dir);
  const raw = Buffer.alloc(320 * 448 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 13 + Math.floor(i / 960) * 29) % 256;
  const image = await sharp(raw, { raw: { width: 320, height: 448, channels: 3 } }).png().toBuffer();
  let downloads = 0;
  const server = createServer((req, res) => {
    downloads++;
    res.writeHead(req.url === '/card.png' ? 200 : 404, { 'Content-Type': 'image/png' });
    res.end(image);
  });
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/card.png`;
    const cards = [
      { id: 'full-art-printing', oracle_id: 'jodah-oracle', name: 'Jodah, the Unifier', set: 'aaa', collector_number: '1' },
      { id: 'planeswalker-printing', oracle_id: 'walker-oracle', name: 'Planeswalker', set: 'bbb', collector_number: '2' },
      { id: 'secret-lair-printing', oracle_id: 'jodah-oracle', name: 'Jodah, the Unifier', set: 'sld', collector_number: '1932' },
    ].map((card, i) => ({ ...card, lang: i ? 'en' : 'ja', games: ['paper'], colors: ['W'],
      image_uris: { art_crop: `${url}/never-fetch-art`, normal: url } }));
    const input = join(dir, 'input.jsonl');
    await writeFile(input, [...cards, { ...cards[0], id: 'digital', games: ['arena'] }].map(c => JSON.stringify(c)).join('\n'));
    const args = [
      resolve('node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/offline/buildOfflineDb.ts',
      '--input', input, '--out', dir, '--source-updated', '2026-01-01T00:00:00Z', '--cache', join(dir, 'cache.sqlite'),
    ];
    const run = (...extra: string[]) => promisify(execFile)(process.execPath, [...args, ...extra], { timeout: 30000 });
    const manifestPath = join(dir, 'manifest.v3.json');
    await assert.rejects(run('--budget-minutes', '0.000000001'), { code: 75 });
    await assert.rejects(readFile(manifestPath), /ENOENT/);
    await run();
    assert.ok(downloads >= 1 && downloads <= cards.length);
    const firstDownloads = downloads;
    await run();
    assert.equal(downloads, firstDownloads);
    const validated = await validateCatalog(manifestPath);
    assert.equal(validated.printingCount, 3);
    assert.deepEqual(validated.languages, ['en', 'ja']);
    const entries = (await Promise.all(validated.verified.map(async ({ info }) =>
      decodeOfflineDb(gunzipSync(await readFile(join(dir, info.file)))).entries))).flat();
    assert.deepEqual(entries.map((entry) => entry.id).sort(), cards.map((card) => card.id).sort());
    const expected = await cardRegionHashes(image);
    for (const entry of entries) {
      assert.deepEqual({ ...entry, ...expected }, entry);
    }
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not publish a partial catalog when a full-card download fails', async () => {
  const dir = join(process.cwd(), `tcgdb-failed-download-${randomUUID()}`);
  await mkdir(dir);
  const server = createServer((_req, res) => { res.writeHead(503); res.end(); });
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
    await assert.rejects(readFile(join(dir, 'manifest.v3.json')), /ENOENT/);
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('skips printings whose full-card image no longer exists', async () => {
  const dir = join(process.cwd(), `tcgdb-missing-image-${randomUUID()}`);
  await mkdir(dir);
  const raw = Buffer.alloc(320 * 448 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 13 + Math.floor(i / 960) * 29) % 256;
  const image = await sharp(raw, { raw: { width: 320, height: 448, channels: 3 } }).png().toBuffer();
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/card.png' ? 200 : 404, { 'Content-Type': 'image/png' });
    res.end(image);
  });
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const input = join(dir, 'input.json');
    const card = { oracle_id: 'oracle', name: 'Example', set: 'sld', collector_number: '1', lang: 'en', colors: ['W'] };
    await writeFile(input, JSON.stringify({
      last_updated: '2026-01-01T00:00:00Z',
      cards: [
        { ...card, id: 'present', image_uris: { normal: `${base}/card.png` } },
        { ...card, id: 'missing', image_uris: { normal: `${base}/missing.png` } },
      ],
    }));
    await promisify(execFile)(process.execPath, [
      resolve('node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/offline/buildOfflineDb.ts',
      '--input', input, '--out', dir,
    ], { cwd: process.cwd(), timeout: 30000 });
    const validated = await validateCatalog(join(dir, 'manifest.v3.json'));
    assert.equal(validated.printingCount, 1);
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});
