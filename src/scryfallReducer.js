import fs from 'fs';
import { fetch } from 'undici';

const BULK_META_URL = 'https://api.scryfall.com/bulk-data/default_cards';
const REDUCED_JSON_FILE = './data/scryfall-reduced.json';
const UPDATED_TRACKER = './data/last_updated.json';

function fileExists(path) {
  return fs.existsSync(path);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function fetchScryfallMetadata() {
  const res = await fetch(BULK_META_URL);
  if (!res.ok) throw new Error('❌ Error al obtener metadata de Scryfall.');
  return await res.json();
}

async function fetchBulkJson(downloadUri) {
  const res = await fetch(downloadUri);
  if (!res.ok) throw new Error('❌ Error al descargar bulk JSON.');
  return await res.json();
}

function reduceCard(card) {
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
    card_faces: card.card_faces?.map(face => ({
      name: face.name,
    })),
    all_parts: card.all_parts?.map(part => ({
      name: part.name,
    })),
    legalities: {
      commander: card.legalities?.commander,
    },
    games: card.games,
    set_name: card.set_name,
    rarity: card.rarity,
  };
}

async function main() {
  try {
    console.log('🔍 Consultando metadata de Scryfall...');
    const meta = await fetchScryfallMetadata();
    const remoteUpdated = meta.updated_at;

    let localUpdated = null;
    if (fileExists(UPDATED_TRACKER)) {
      localUpdated = readJson(UPDATED_TRACKER).updated_at;
    }

    /*if (remoteUpdated === localUpdated) {
      console.log('🟢 Ya tienes la última versión del bulk de Scryfall. Nada que hacer.');
      return;
    }*/

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