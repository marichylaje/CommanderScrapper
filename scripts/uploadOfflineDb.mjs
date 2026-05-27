import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { put } from '@vercel/blob';

const { BLOB_READ_WRITE_TOKEN } = process.env;
const OFFLINE_DIR = join(process.cwd(), 'data', 'offline');

if (!BLOB_READ_WRITE_TOKEN) {
  console.error('❌ BLOB_READ_WRITE_TOKEN env var is not set');
  process.exit(1);
}

const manifestPath = join(OFFLINE_DIR, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

const version = manifest.version || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const prefix = `offline-db/${version}`;

const buckets = Object.entries(manifest.buckets ?? {});
for (const [bucket, info] of buckets) {
  const fileName = info.file;
  const filePath = join(OFFLINE_DIR, fileName);
  const data = readFileSync(filePath);
  console.log(`📤 Uploading ${fileName} (${bucket})...`);
  const blob = await put(`${prefix}/${fileName}`, data, {
    access: 'public',
    allowOverwrite: true,
    contentType: 'application/octet-stream',
    token: BLOB_READ_WRITE_TOKEN,
  });
  manifest.buckets[bucket].url = blob.url;
}

const manifestBlob = await put(`${prefix}/manifest.json`, JSON.stringify(manifest, null, 2), {
  access: 'public',
  allowOverwrite: true,
  contentType: 'application/json',
  token: BLOB_READ_WRITE_TOKEN,
});

await put(`offline-db/latest.json`, JSON.stringify(manifest, null, 2), {
  access: 'public',
  allowOverwrite: true,
  contentType: 'application/json',
  token: BLOB_READ_WRITE_TOKEN,
});

console.log('✅ Offline DB uploaded.');
console.log(`   Manifest URL: ${manifestBlob.url}`);
