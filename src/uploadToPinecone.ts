import fs from 'fs';
import { config as loadEnv } from 'dotenv';
import { OpenAI } from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';

loadEnv();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const index = pinecone.Index(process.env.PINECONE_INDEX!); // debe existir

const cards = JSON.parse(fs.readFileSync('./data/scryfall-reduced.json', 'utf-8')).cards;

// 🔤 Normaliza el texto a ASCII-safe y legible
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
  const suffix = `${card.set ?? 'x'}_${card.collector_number ?? Math.random().toString(36).slice(2, 6)}`;
  return `${base}_${suffix}`;
}

// 📄 Construye el texto a embebar
function getEmbeddingText(card: any): string {
  if (card.card_faces?.length > 0) {
    return card.card_faces
      .map((f: any) => `${f.name}: ${f.oracle_text ?? ''}`)
      .join(' // ');
  } else {
    return `${card.name}: ${card.oracle_text ?? ''}`;
  }
}

// 🧹 Limpia metadata eliminando claves con undefined
function cleanMetadata(obj: Record<string, any>) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}

async function processAndUpload() {
  for (const card of cards) {
    try {
      const inputText = getEmbeddingText(card);
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: inputText,
      });

      const id = generateUniqueId(card);

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
    } catch (err) {
      console.error(`❌ Error al subir ${card.name}:`, err);
    }
  }

  console.log('🚀 Todo subido a Pinecone.');
}

processAndUpload().catch(console.error);
