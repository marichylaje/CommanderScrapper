import { parseArgs } from 'node:util';
import { LOCAL_MANIFEST, validateCatalog } from './offlineManifest.js';

const { values } = parseArgs({ options: {
  manifest: { type: 'string', default: LOCAL_MANIFEST },
  version: { type: 'string' },
} });

try {
  const { manifest, verified, printingCount, languages } = await validateCatalog(values.manifest, values.version);
  for (const { bucket, info } of verified) console.log(`${bucket}: ${info.count} printings, SHA-256 OK`);
  console.log(`Catalog ${manifest.version}: ${printingCount} printings (${languages.join(', ')})`);
} catch (error) {
  console.error('Offline catalog validation failed:', error);
  process.exitCode = 1;
}
