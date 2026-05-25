import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { join } from 'node:path';
import type { ReducedCard } from './schemas/zodSchemas.js';

const BULK_META_URL = 'https://api.scryfall.com/bulk-data/default_cards';
const REDUCED_JSON_FILE = './data/scryfall-reduced.json';
const TEMP_BULK_FILE = join(process.cwd(), 'data', '_bulk_temp.json');
const UPDATED_TRACKER = './data/last_updated.json';

interface ScryfallMeta {
  updated_at: string;
  download_uri: string;
}

function fileExists(path: string): boolean {
  return fs.existsSync(path);
}

function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function fetchScryfallMetadata(): Promise<ScryfallMeta> {
  const res = await fetch(BULK_META_URL);
  if (!res.ok) throw new Error('❌ Error al obtener metadata de Scryfall.');
  return (await res.json()) as ScryfallMeta;
}

/**
 * Downloads a URL to a local file, following redirects.
 * Uses Node's built-in https/http to avoid undici string-length limits.
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    let lastLog = 0;

    function doGet(targetUrl: string): void {
      const mod = targetUrl.startsWith('https://') ? https : http;
      mod.get(targetUrl, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading bulk data`));
          return;
        }
        const total = Number(res.headers['content-length'] ?? 0);
        const dest = fs.createWriteStream(destPath);

        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          const now = Date.now();
          if (now - lastLog > 5000) {
            const mb = (totalBytes / 1024 / 1024).toFixed(0);
            const pct = total ? ` (${((totalBytes / total) * 100).toFixed(0)}%)` : '';
            process.stdout.write(`   ↓ ${mb} MB descargados${pct}...\n`);
            lastLog = now;
          }
        });

        res.pipe(dest);
        dest.on('finish', () => dest.close(() => resolve()));
        dest.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    }
    doGet(url);
  });
}

/**
 * Stream-parses a large JSON array from a file, calling onItem for each element.
 * Never loads the full file into memory — works even for 500 MB+ files.
 */
function streamJsonArray(filePath: string, onItem: (item: unknown) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, {
      encoding: 'utf-8',
      highWaterMark: 1024 * 1024, // 1 MB chunks
    });

    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let inArray = false;
    let objectParts: string[] = [];
    let objectChunkStart = -1;
    let processed = 0;
    let lastLog = Date.now();

    readStream.on('data', (chunk: string) => {
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (ch === '\\' && inString) {
          escapeNext = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;

        if (!inArray) {
          if (ch === '[') inArray = true;
          continue;
        }

        if (ch === '{') {
          if (depth === 0) {
            objectChunkStart = i;
            objectParts = [];
          }
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            objectParts.push(chunk.slice(objectChunkStart, i + 1));
            try {
              onItem(JSON.parse(objectParts.join('')));
              processed++;
              const now = Date.now();
              if (now - lastLog > 5000) {
                process.stdout.write(`   ⚙️  Procesadas ${processed.toLocaleString()} cartas...\n`);
                lastLog = now;
              }
            } catch { /* skip malformed entries */ }
            objectParts = [];
            objectChunkStart = -1;
          }
        }
      }

      // If we're mid-object at end of chunk, save the tail for the next chunk
      if (depth > 0 && objectChunkStart >= 0) {
        objectParts.push(chunk.slice(objectChunkStart));
        objectChunkStart = 0; // next chunk continues from its start
      }
    });

    readStream.on('end', () => {
      process.stdout.write(`   ✅ Parseadas ${processed.toLocaleString()} cartas en total\n`);
      resolve();
    });
    readStream.on('error', reject);
  });
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

  const face_flavor_names =
    Array.isArray(faces)
      ? faces.map(f => f.flavor_name).filter((s): s is string => !!s && s.trim().length > 0)
      : [];

  // NUEVO: si no hay flavor_name raíz y la cara frontal tiene, copiarlo
  const root_flavor_name = card.flavor_name ?? (face_flavor_names[0] ?? undefined);

  return {
    name: card.name,
    flavor_name: root_flavor_name, // puede venir a nivel de carta
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
      flavor_name: face.flavor_name ?? undefined,
      mana_cost: face.mana_cost,
      image_uris: face.image_uris,
    })),
  };
}

// Normaliza strings para comparaciones robustas (apóstrofos, NFKC, trim)
const normalize = (s?: string) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[\u2019'']/g, "'")
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

    console.log('📥 Archivo actualizado. Descargando bulk data...');
    await downloadFile(meta.download_uri, TEMP_BULK_FILE);
    console.log('✅ Descarga completada. Procesando cartas...');

    // Stream-parse the bulk file and collect reduced cards
    const rawCards: ReducedCard[] = [];
    await streamJsonArray(TEMP_BULK_FILE, (item) => {
      rawCards.push(item as ReducedCard);
    });

    // Clean up the temp file
    try { fs.unlinkSync(TEMP_BULK_FILE); } catch { /* ignore */ }

    // Filtramos tokens de criatura (ajusta si quieres excluir otros tipos)
    const filteredData = rawCards.filter(
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
