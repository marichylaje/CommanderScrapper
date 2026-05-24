import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type CardData = {
  card_faces?: Array<{ image_uris?: { art_crop?: string; normal?: string } }>;
  id: string;
  image_uris?: {
    art_crop?: string;
    normal?: string;
  };
  name: string;
  oracle_id: string;
};

type ReducedDataset = {
  cards: CardData[];
  last_updated: string;
};

let cachedDataset: ReducedDataset | null = null;
let loadPromise: Promise<ReducedDataset> | null = null;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\u2019'']/g, "'")
    .normalize('NFKC')
    .trim();

async function loadLocalDataset(): Promise<ReducedDataset> {
  if (cachedDataset) {
    return cachedDataset;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const dataPath = join(process.cwd(), 'data', 'scryfall-reduced.json');
    const content = await readFile(dataPath, 'utf-8');
    const dataset = JSON.parse(content) as ReducedDataset;
    cachedDataset = dataset;
    console.log(`✅ Loaded ${dataset.cards.length} cards from local dataset (updated: ${dataset.last_updated})`);
    return dataset;
  })();

  return loadPromise;
}

export async function findPrintingsByOracleId(oracleId: string): Promise<CardData[]> {
  const dataset = await loadLocalDataset();
  return dataset.cards.filter((card) => card.oracle_id === oracleId);
}

export async function findPrintingsByName(name: string): Promise<CardData[]> {
  const dataset = await loadLocalDataset();
  const normalizedSearchName = normalize(name);
  return dataset.cards.filter((card) => normalize(card.name) === normalizedSearchName);
}

export async function findPrintings({
  oracleId,
  name,
}: {
  name?: string;
  oracleId?: string;
}): Promise<CardData[]> {
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
