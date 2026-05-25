/**
 * uploadToBlob.mjs
 *
 * Uploads data/fingerprint-index.json to Vercel Blob as a public file,
 * overwriting any existing blob at the same pathname.
 *
 * Uses the @vercel/blob Node.js SDK instead of the Vercel CLI so we avoid
 * CLI version quirks (e.g. the unsupported --access flag).
 *
 * Env vars required:
 *   BLOB_READ_WRITE_TOKEN   RW token for the Vercel Blob store
 */

import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { put } from '@vercel/blob';

const FILE_PATH = join(process.cwd(), 'data', 'fingerprint-index.json');
const { BLOB_READ_WRITE_TOKEN } = process.env;

if (!BLOB_READ_WRITE_TOKEN) {
  console.error('❌ BLOB_READ_WRITE_TOKEN env var is not set');
  process.exit(1);
}

async function main() {
  const sizeBytes = statSync(FILE_PATH).size;
  const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);
  console.log(`📤 Uploading fingerprint-index.json (${sizeMb} MB) to Vercel Blob…`);

  const stream = createReadStream(FILE_PATH);

  const blob = await put('fingerprint-index.json', stream, {
    access: 'public',
    allowOverwrite: true,
    contentType: 'application/json',
    token: BLOB_READ_WRITE_TOKEN,
  });

  console.log(`✅ Uploaded successfully`);
  console.log(`   URL: ${blob.url}`);
}

main().catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
