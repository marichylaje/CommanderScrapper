import fs from 'fs';
import { fetch } from 'undici';
import type { ReducedCard } from './schemas/zodSchemas';

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
  return (await res.json()) as ScryfallMeta;
}

async function fetchBulkJson(downloadUri: string): Promise<ReducedCard[]> {
  const res = await fetch(downloadUri);
  if (!res.ok) throw new Error('❌ Error al descargar bulk JSON.');
  return (await res.json()) as ReducedCard[];
}

function reduceCard(card: ReducedCard) {
  const faces = card.card_faces;
  let face_name: string | undefined;

  // Si tiene al menos dos caras y nombres distintos, guardamos el nombre de la primera cara
  if (
    Array.isArray(faces) &&
    faces.length >= 2 &&
    faces[0].name !== faces[1].name
  ) {
    face_name = faces[0].name;
  }

  return {
    name: card.name,
    flavor_name: (card as any).flavor_name, // puede venir a nivel de carta
    face_name, // campo opcional
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
    card_faces: faces?.map((face) => ({
      name: face.name,
      type_line: face.type_line,
      mana_cost: face.mana_cost,
      image_uris: face.image_uris,
    })),
  };
}

// Normaliza strings para comparaciones robustas (apóstrofos, NFKC, trim)
const normalize = (s?: string) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[\u2019’']/g, "'")
    .normalize('NFKC')
    .trim();

// released_at viene "YYYY-MM-DD": comparación lexicográfica sirve
const dateKey = (s?: string) => s ?? '0000-00-00';

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

    // Filtramos tokens de criatura (ajusta si quieres excluir otros tipos)
    const filteredData = rawData.filter(
      (card) => !card.type_line?.startsWith('Token Creature'),
    );

    // Reducimos las cartas al shape final
    const reducedAll = filteredData.map(reduceCard);

    /**
     * ✅ NUEVO COMPORTAMIENTO:
     * Agrupamos por oracle_id y conservamos:
     *  1) La IMPRESIÓN MÁS NUEVA (siempre)
     *  2) La IMPRESIÓN MÁS NUEVA de CADA flavor_name distinto (si existe)
     *
     * Resultado: para un mismo oracle_id (p.ej. "Bojuka Bog"), si existe una
     * reimpresión con alias ("Barrow-Downs"), se añade también esa impresión.
     */
    type Reduced = ReturnType<typeof reduceCard>;
    const byOracle: Record<string, Reduced[]> = {};
    for (const c of reducedAll) {
      (byOracle[c.oracle_id] ??= []).push(c);
    }

    const reducedCards: Reduced[] = [];
    let aliasDocsAdded = 0;

    for (const oracleId of Object.keys(byOracle)) {
      const group = byOracle[oracleId];

      // ordenamos por fecha desc para tener "más nuevo" primero
      group.sort((a, b) => (dateKey(b.released_at) > dateKey(a.released_at) ? 1 : -1));

      // 1) siempre incluimos la versión más nueva
      const newest = group[0];
      reducedCards.push(newest);

      // 2) por cada flavor_name distinto, elegir la versión MÁS NUEVA que tenga ese alias
      const pickByFlavor = new Map<string, Reduced>(); // key normalizada → doc
      for (const c of group) {
        const fn = c.flavor_name;
        if (!fn || !fn.trim()) continue;
        const key = normalize(fn);
        const prev = pickByFlavor.get(key);
        if (!prev || dateKey(c.released_at) > dateKey(prev.released_at)) {
          pickByFlavor.set(key, c);
        }
      }

      // 3) añadir los docs de alias (evitando duplicar el "newest" por id)
      for (const doc of pickByFlavor.values()) {
        if (doc.id !== newest.id) {
          reducedCards.push(doc);
          aliasDocsAdded++;
        }
      }
    }

    const output = {
      last_updated: remoteUpdated,
      cards: reducedCards,
    };

    writeJson(REDUCED_JSON_FILE, output);
    writeJson(UPDATED_TRACKER, { updated_at: remoteUpdated });

    console.log('✅ Archivo reducido generado:', REDUCED_JSON_FILE);
    console.log(`ℹ️ Cartas totales: ${reducedCards.length} (alias añadidos: ${aliasDocsAdded})`);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main();
