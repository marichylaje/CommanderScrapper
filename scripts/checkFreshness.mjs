/**
 * checkFreshness.mjs
 *
 * Compares Scryfall's bulk-data updated_at with the source_updated field
 * stored in the deployed fingerprint index (read via a Range request so we
 * don't download the entire ~40 MB file).
 *
 * Outputs:
 *   needs_update=true/false  →  $GITHUB_OUTPUT
 *
 * Env vars required:
 *   FINGERPRINT_INDEX_URL   Public URL of the fingerprint-index.json blob
 *   FORCE_REBUILD           Set to 'true' to skip the check and always rebuild
 */

import { appendFileSync } from 'node:fs';

const SCRYFALL_BULK_META = 'https://api.scryfall.com/bulk-data/default_cards';
const { FINGERPRINT_INDEX_URL, FORCE_REBUILD, GITHUB_OUTPUT } = process.env;

function setOutput(name, value) {
  const line = `${name}=${value}\n`;
  if (GITHUB_OUTPUT) {
    appendFileSync(GITHUB_OUTPUT, line);
  } else {
    process.stdout.write(`::set-output name=${name}::${value}\n`);
  }
  console.log(`  → ${name}=${value}`);
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

async function fetchIndexHeader(url) {
  // Use a Range request to avoid downloading the full ~40 MB file.
  // The header fields (generated_at, source_updated, total) appear in the
  // first few hundred bytes of the JSON.
  const res = await fetch(url, {
    headers: { Range: 'bytes=0-511' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status} fetching index header`);
  }

  const text = await res.text();
  const match = text.match(/"source_updated"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

async function main() {
  if (FORCE_REBUILD === 'true') {
    console.log('🔧 FORCE_REBUILD=true — skipping freshness check');
    setOutput('needs_update', 'true');
    return;
  }

  if (!FINGERPRINT_INDEX_URL) {
    console.error('❌ FINGERPRINT_INDEX_URL env var is not set');
    process.exit(1);
  }

  console.log('🔍 Fetching Scryfall bulk-data metadata…');
  const scryfall = await fetchJson(SCRYFALL_BULK_META);
  const scryfallUpdatedAt = scryfall.updated_at;
  console.log(`   Scryfall updated_at:   ${scryfallUpdatedAt}`);

  console.log('🔍 Reading fingerprint index header (Range request)…');
  let indexSourceUpdated = null;
  try {
    indexSourceUpdated = await fetchIndexHeader(FINGERPRINT_INDEX_URL);
    console.log(`   Index source_updated:  ${indexSourceUpdated ?? '(not found)'}`);
  } catch (err) {
    console.log(`   ⚠️  Could not read index header (${err.message}) — will rebuild`);
    setOutput('needs_update', 'true');
    return;
  }

  if (!indexSourceUpdated || scryfallUpdatedAt !== indexSourceUpdated) {
    console.log('🆕 Scryfall data is newer than the current index — rebuild needed');
    setOutput('needs_update', 'true');
  } else {
    console.log('✅ Fingerprint index is already up-to-date — no rebuild needed');
    setOutput('needs_update', 'false');
  }
}

main().catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
