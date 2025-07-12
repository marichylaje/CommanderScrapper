import fs from 'fs';
import { config as loadEnv } from 'dotenv';
import { OpenAI } from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';

loadEnv();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const index = pinecone.Index(process.env.PINECONE_INDEX!);

const REDUCED_FILE = './data/scryfall-reduced.json';
const TRACKER_FILE = './data/uploaded_ids.json';

const cards = JSON.parse(fs.readFileSync(REDUCED_FILE, 'utf-8')).cards;
let uploadedIds: string[] = [];

function normalizeId(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
}

function generateUniqueId(card: any): string {
  const base = normalizeId(card.name);
  const suffix = `${card.set ?? 'x'}_${card.collector_number ?? '000'}`;
  return `${base}_${suffix}`;
}

function getEmbeddingText(card: any): string {
  if (card.card_faces?.length > 0) {
    return card.card_faces.map((f: any) => `${f.name}: ${f.oracle_text ?? ''}`).join(' // ');
  } else {
    return `${card.name}: ${card.oracle_text ?? ''}`;
  }
}

function cleanMetadata(obj: Record<string, any>) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}

function loadUploadedIds(): string[] {
  try {
    if (!fs.existsSync(TRACKER_FILE)) return [];
    return JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveUploadedIds(ids: string[]) {
  fs.writeFileSync(TRACKER_FILE, JSON.stringify(ids, null, 2));
}

async function processAndUpload() {
  uploadedIds = loadUploadedIds();
  const newUploadedIds = [...uploadedIds];

  for (const card of cards) {
    const id = generateUniqueId(card);

    if (uploadedIds.includes(id)) {
      console.log(`⏩ Ya subida: ${card.name}`);
      continue;
    }

    try {
      const inputText = getEmbeddingText(card);
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: inputText,
      });

      const metadata = cleanMetadata({
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        keywords: card.keywords,
        colors: card.colors,
        cmc: card.cmc,
        mana_cost: card.mana_cost,
        power: card.power,
        toughness: card.toughness,
        loyalty: card.loyalty,
        layout: card.layout,
        rarity: card.rarity,
        games: card.games,
        set_name: card.set_name,
        card_faces: card.card_faces ? JSON.stringify(card.card_faces) : undefined,
        all_parts: card.all_parts ? JSON.stringify(card.all_parts) : undefined,
        legalities: card.legalities ? JSON.stringify(card.legalities) : undefined,
      });

      const vector = {
        id,
        values: response.data[0].embedding,
        metadata,
      };

      await index.upsert([vector]);
      console.log(`✅ Subida: ${card.name}`);

      newUploadedIds.push(id);
      saveUploadedIds(newUploadedIds);
      console.log(`💾 Guardado en uploaded_ids.json: ${id}`);
    } catch (err) {
      console.error(`❌ Error al subir ${card.name}:`, err);
    }
  }

  console.log('🚀 Todo actualizado en Pinecone.');
}

processAndUpload().catch(console.error);
