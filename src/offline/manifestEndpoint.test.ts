import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import serve from '../../api/offline-db/manifest-v3.js';

test('v3 endpoint reads only the v3 alias and fails closed on legacy or reordered manifests', async (t) => {
  const manifest = {
    schema: 3, version: 'candidate', generator: { entry_version: 3, crop_hashes: ['art', 'normal', 'center', 'left', 'right'] },
    buckets: Object.fromEntries(['W', 'U', 'B', 'R', 'G', 'C', 'M'].map(k => [k, { url: `https://example.test/${k}` }])),
  };
  let url = '';
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    url = input;
    return Response.json(manifest);
  });
  const env = process.env;
  process.env = { ...env, OFFLINE_DB_MANIFEST_V3_URL: '', OFFLINE_DB_LATEST_V3_URL: '' };
  t.after(() => { process.env = env; });
  let status: number | undefined;
  const res = {
    status(n: number) { status = n; return this; }, setHeader() {}, json(body: unknown) { return body; },
  };
  const get = () => serve({ method: 'GET', headers: {} } as VercelRequest, res as unknown as VercelResponse);
  assert.deepEqual(await get(), manifest);
  assert.equal(status, 200);
  assert.ok(url.endsWith('/offline-db/latest-v3.json'));
  process.env.OFFLINE_DB_MANIFEST_V3_URL = 'https://example.test/verified-candidate';
  assert.deepEqual(await get(), manifest);
  assert.equal(url, process.env.OFFLINE_DB_MANIFEST_V3_URL);
  manifest.schema = 2;
  await get();
  assert.equal(status, 503);
  manifest.schema = 3;
  manifest.generator.crop_hashes.reverse();
  await get();
  assert.equal(status, 503);
});
