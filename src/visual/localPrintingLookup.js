import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
let cachedDataset = null;
let loadPromise = null;
const normalize = (value) => value
    .toLowerCase()
    .replace(/[\u2019'']/g, "'")
    .normalize('NFKC')
    .trim();
async function loadLocalDataset() {
    if (cachedDataset) {
        return cachedDataset;
    }
    if (loadPromise) {
        return loadPromise;
    }
    loadPromise = (async () => {
        const dataPath = join(process.cwd(), 'data', 'scryfall-reduced.json');
        const content = await readFile(dataPath, 'utf-8');
        const dataset = JSON.parse(content);
        cachedDataset = dataset;
        console.log(`✅ Loaded ${dataset.cards.length} cards from local dataset (updated: ${dataset.last_updated})`);
        return dataset;
    })();
    return loadPromise;
}
export async function findPrintingsByOracleId(oracleId) {
    const dataset = await loadLocalDataset();
    return dataset.cards.filter((card) => card.oracle_id === oracleId);
}
export async function findPrintingsByName(name) {
    const dataset = await loadLocalDataset();
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
