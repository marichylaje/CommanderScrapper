import fs from 'fs';
import { fetch } from 'undici';
import { ReducedCardSchema, ReducedCard } from './schemas/zodSchemas';

const BULK_META_URL = 'https://api.scryfall.com/bulk-data/default_cards';
const REDUCED_JSON_FILE = './data/scryfall-reduced.json';
const UPDATED_TRACKER = './data/last_updated.json';

interface ScryfallMeta {
  updated_at: string;
  download_uri: string;
}

function fileExists(path: string): boolean {
  return fs.existsSync(path);
}

function readJson<T = any>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, data: any): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function fetchScryfallMetadata(): Promise<ScryfallMeta> {
  const res = await fetch(BULK_META_URL);
  if (!res.ok) throw new Error('❌ Error al obtener metadata de Scryfall.');
  return await res.json() as ScryfallMeta;
}

async function fetchBulkJson(downloadUri: string): Promise<ReducedCard[]> {
  const res = await fetch(downloadUri);
  if (!res.ok) throw new Error('❌ Error al descargar bulk JSON.');
  return await res.json() as ReducedCard[];
}

function reduceCard(card: ReducedCard) {
  return {
    name: card.name,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    collector_number: card.collector_number,
    color_identity: card.color_identity,
    colors: card.colors,
    games: card.games,
    id: card.id,
    image_uris: card.image_uris,
    keywords: card.keywords,
    oracle_id: card.oracle_id,
    oracle_text: card.oracle_text,
    prices: card.prices,
    purchase_uris: card.purchase_uris,
    rarity: card.rarity,
    set: card.set,
    type_line: card.type_line,
    released_at: card.released_at,
    card_faces: card.card_faces?.map((face) => ({
      name: face.name,
      type_line: face.type_line,
      mana_cost: face.mana_cost,
      image_uris: face.image_uris,
    })),
  };
}


async function main(): Promise<void> {
  try {
    console.log('🔍 Consultando metadata de Scryfall...');
    const meta = await fetchScryfallMetadata();
    const remoteUpdated = meta.updated_at;

    let localUpdated: string | null = null;
    if (fileExists(UPDATED_TRACKER)) {
      localUpdated = readJson<{ updated_at: string }>(UPDATED_TRACKER).updated_at;
    }

    if (remoteUpdated === localUpdated) {
      console.log('🟢 Ya tienes la última versión del bulk de Scryfall. Nada que hacer.');
      return;
    }

    console.log('📥 Archivo actualizado. Descargando y procesando...');
    const rawData = await fetchBulkJson(meta.download_uri);
    const filteredData = rawData.filter(
      (card) => !card.type_line?.startsWith('Token Creature'),
    );

    // Reducimos las cartas
    const reducedAll = filteredData.map(reduceCard);

    // Elegimos solo la versión más nueva por oracle_id
    const byNewestOracle: Record<string, ReturnType<typeof reduceCard>> = {};

    for (const card of reducedAll) {
      const existing = byNewestOracle[card.oracle_id];

      if (!existing || (card.released_at && existing.released_at && card.released_at > existing.released_at)) {
        byNewestOracle[card.oracle_id] = card;
      }
    }

    const reducedCards = Object.values(byNewestOracle);
        
    const output = {
      last_updated: remoteUpdated,
      cards: reducedCards,
    };

    writeJson(REDUCED_JSON_FILE, output);
    writeJson(UPDATED_TRACKER, { updated_at: remoteUpdated });

    console.log('✅ Archivo reducido generado:', REDUCED_JSON_FILE);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main();
