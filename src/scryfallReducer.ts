import fs from 'fs';
import { fetch } from 'undici';

const BULK_META_URL = 'https://api.scryfall.com/bulk-data/default_cards';
const REDUCED_JSON_FILE = './data/scryfall-reduced.json';
const UPDATED_TRACKER = './data/last_updated.json';

interface ScryfallMeta {
  updated_at: string;
  download_uri: string;
}

interface CardFace {
  name: string;
}

interface CardPart {
  name: string;
}

interface Card {
  name: string;
  type: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  keywords?: string[];
  card_faces?: CardFace[];
  all_parts?: CardPart[];
  legalities?: {
    commander?: string;
  };
  games?: string[];
  set_name?: string;
  rarity?: string;
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
  return await res.json();
}

async function fetchBulkJson(downloadUri: string): Promise<Card[]> {
  const res = await fetch(downloadUri);
  if (!res.ok) throw new Error('❌ Error al descargar bulk JSON.');
  return await res.json();
}

function reduceCard(card: Card) {
  return {
    name: card.name,
    type: card.type,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    type_line: card.type_line,
    description: card.oracle_text,
    power: card.power,
    toughness: card.toughness,
    colors: card.colors,
    keywords: card.keywords,
    card_faces: card.card_faces?.map(face => ({ name: face.name })),
    all_parts: card.all_parts?.map(part => ({ name: part.name })),
    legalities: {
      commander: card.legalities?.commander,
    },
    games: card.games,
    set_name: card.set_name,
    rarity: card.rarity,
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
    const reducedCards = rawData.map(reduceCard);

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
