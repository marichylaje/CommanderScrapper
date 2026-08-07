import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const DATA_PATH = join(process.cwd(), 'data', 'scryfall-reduced.json');
const DATA_URL = process.env.SCRYFALL_REDUCED_URL;
let cachedDataset = null;
let loadPromise = null;
const normalize = (value) => value
    .toLowerCase()
    .replace(/[\u2019'']/g, "'")
    .normalize('NFKC')
    .trim();
async function loadDataset() {
    if (cachedDataset !== null)
        return cachedDataset;
    if (loadPromise)
        return loadPromise;
    loadPromise = (async () => {
        // Try Blob URL first
        if (DATA_URL) {
            try {
                const res = await fetch(DATA_URL, { signal: AbortSignal.timeout(30_000) });
                if (res.ok) {
                    const data = (await res.json());
                    console.log(`✅ scryfall-reduced loaded from URL: ${data.cards.length} cards`);
                    cachedDataset = data;
                    return data;
                }
                console.warn(`⚠️ scryfall-reduced URL returned HTTP ${res.status}`);
            }
            catch (err) {
                console.warn('⚠️ Failed to fetch scryfall-reduced from URL, trying local file...', err);
            }
        }
        else {
            console.warn('⚠️ SCRYFALL_REDUCED_URL is not set, trying local file...');
        }
        // Fallback to local file
        try {
            await access(DATA_PATH);
            const content = await readFile(DATA_PATH, 'utf-8');
            const data = JSON.parse(content);
            console.log(`✅ scryfall-reduced loaded from file: ${data.cards.length} cards`);
            cachedDataset = data;
            return data;
        }
        catch {
            console.warn('⚠️ scryfall-reduced.json not available (neither URL nor local file)');
            return null;
        }
    })();
    return loadPromise;
}
// Pre-warm when module is imported
loadDataset().catch(() => { });
export async function findPrintingsByOracleId(oracleId) {
    const dataset = await loadDataset();
    if (!dataset)
        return [];
    return dataset.cards.filter((card) => card.oracle_id === oracleId);
}
export async function findPrintingsByName(name) {
    const dataset = await loadDataset();
    if (!dataset)
        return [];
    const normalizedSearchName = normalize(name);
    return dataset.cards.filter((card) => normalize(card.name) === normalizedSearchName);
}
export async function findPrintings({ oracleId, name, }) {
    if (oracleId) {
        const results = await findPrintingsByOracleId(oracleId);
        if (results.length > 0) {
            return results;
        }
    }
    if (name) {
        return findPrintingsByName(name);
    }
    return [];
}
export async function findCardById(id) {
    const dataset = await loadDataset();
    if (!dataset)
        return null;
    return dataset.cards.find((card) => card.id === id) ?? null;
}
