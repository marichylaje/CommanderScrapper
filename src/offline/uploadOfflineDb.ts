import { parseArgs } from 'node:util';
import { put } from '@vercel/blob';
import { LOCAL_MANIFEST, validateCatalog } from './offlineManifest.js';

const { values } = parseArgs({ options: {
  manifest: { type: 'string', default: LOCAL_MANIFEST },
  'promote-latest': { type: 'boolean', default: false },
} });

try {
  if (/^https?:/i.test(values.manifest)) throw new Error('Upload requires a local manifest');
  const { manifest, verified, printingCount } = await validateCatalog(values.manifest);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  const prefix = `offline-db/${manifest.version}`;
  console.log(`Validated ${printingCount} printings before upload`);

  for (const { bucket, info, bytes } of verified) {
    const blob = await put(`${prefix}/${info.file}`, bytes, {
      access: 'public', addRandomSuffix: true,
      contentType: 'application/octet-stream', token,
    });
    manifest.buckets[bucket] = { ...info, url: blob.url };
    console.log(`Uploaded ${bucket}: ${info.count} printings`);
  }
  const json = JSON.stringify(manifest, null, 2);
  const manifestBlob = await put(`${prefix}/manifest.v2.json`, json, {
    access: 'public', addRandomSuffix: true,
    contentType: 'application/json', token,
  });
  console.log(`Versioned manifest: ${manifestBlob.url}`);
  await validateCatalog(manifestBlob.url, manifest.version);
  console.log(`Validated remote catalog ${manifest.version}`);
  if (values['promote-latest']) {
    const latest = await put('offline-db/latest.json', json, {
      access: 'public', addRandomSuffix: false, cacheControlMaxAge: 60,
      contentType: 'application/json', token,
    });
    console.log(`Promoted latest: ${latest.url}`);
  }
} catch (error) {
  console.error('Offline catalog upload failed:', error);
  process.exitCode = 1;
}
