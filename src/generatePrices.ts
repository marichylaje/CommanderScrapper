// generatePrices.ts
import fs from 'fs';
import path from 'path';
import { fetch } from 'undici';
import type { RequestInit as UndiciRequestInit, Response as UndiciResponse } from 'undici';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';

const SCRYFALL_BULK_INFO_URL = 'https://api.scryfall.com/bulk-data';
const OUTPUT_FILE = './data/reduced-prices.json';
const SCRYFALL_HEADERS = {
  'User-Agent': 'CommanderScrapper/1.0 (MTG Commander Deck Builder app; contact via GitHub)',
  Accept: 'application/json',
};

interface ScryfallCard {
  oracle_id: string;
  prices: {
    usd: string | null;
    eur: string | null;
    usd_foil?: string | null;
    eur_foil?: string | null;
  };
}

interface ReducedPrice {
  id: string;
  usd: number | null;
  eur: number | null;
}

interface ScryfallBulkMetaItem {
  type: string;
  download_uri?: string | null;
  jsonl_download_uri?: string | null;
}

async function fetchWithRetry(url: string, init: UndiciRequestInit, attempts = 3): Promise<UndiciResponse> {
  let lastError: unknown;

  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;

      if (res.status >= 500 && i < attempts) {
        await new Promise((resolve) => setTimeout(resolve, i * 2_000));
        continue;
      }

      throw new Error(`HTTP ${res.status} fetching ${url}`);
    } catch (error) {
      lastError = error;
      if (i < attempts) {
        await new Promise((resolve) => setTimeout(resolve, i * 2_000));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Error desconocido al hacer fetch');
}

function pickBulkUrl(item: ScryfallBulkMetaItem): string {
  const candidate = item.jsonl_download_uri ?? item.download_uri;
  if (!candidate || typeof candidate !== 'string') {
    throw new Error('❌ Scryfall no entregó una URL de descarga utilizable para oracle_cards.');
  }
  return candidate;
}

async function getBulkDownloadUrl(): Promise<string> {
  const res = await fetchWithRetry(SCRYFALL_BULK_INFO_URL, {
    headers: SCRYFALL_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  
  const body = (await res.json()) as { data?: ScryfallBulkMetaItem[] };
  if (!Array.isArray(body.data)) {
    throw new Error('❌ Metadata de Scryfall inválida: no llegó el arreglo "data".');
  }

  // "oracle_cards" contiene una fila por cada carta única por nombre (evita duplicados de reimpresiones)
  const oracleCardsBulk = body.data.find((item) => item.type === 'oracle_cards');
  
  if (!oracleCardsBulk) throw new Error('❌ No se encontró el tipo de datos "oracle_cards" en Scryfall');
  return pickBulkUrl(oracleCardsBulk);
}

function maybeParseNumber(price: string | null | undefined): number | null {
  if (!price) return null;
  const parsed = Number.parseFloat(price);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapPrice(card: ScryfallCard): ReducedPrice | null {
  if (!card.oracle_id) return null;

  const usdPrice = maybeParseNumber(card.prices?.usd);
  const eurPrice = maybeParseNumber(card.prices?.eur);

  if (usdPrice === null && eurPrice === null) {
    return null;
  }

  return {
    id: card.oracle_id,
    usd: usdPrice,
    eur: eurPrice,
  };
}

async function parseJsonlGzFromResponse(res: UndiciResponse): Promise<ReducedPrice[]> {
  if (!res.body) {
    throw new Error('❌ La respuesta de Scryfall no contiene body para stream.');
  }

  const input = Readable.fromWeb(res.body as any);
  const gunzip = zlib.createGunzip();
  const lineReader = readline.createInterface({
    input: input.pipe(gunzip),
    crlfDelay: Infinity,
  });

  const reducedPrices: ReducedPrice[] = [];
  let processed = 0;

  for await (const line of lineReader) {
    if (!line || !line.trim()) continue;
    try {
      const card = JSON.parse(line) as ScryfallCard;
      const mapped = mapPrice(card);
      if (mapped) reducedPrices.push(mapped);
      processed++;
      if (processed % 100_000 === 0) {
        console.log(`⚙️ Procesadas ${processed.toLocaleString()} cartas...`);
      }
    } catch {
      // Ignoramos líneas corruptas puntuales para no tumbar todo el proceso
    }
  }

  return reducedPrices;
}

async function main() {
  try {
    console.log('🔍 Solicitando URL del último Bulk Data a Scryfall...');
    const downloadUrl = await getBulkDownloadUrl();
    
    console.log(`📥 Descargando e interpretando Bulk Data desde: ${downloadUrl}`);
    const res = await fetchWithRetry(downloadUrl, {
      headers: SCRYFALL_HEADERS,
      signal: AbortSignal.timeout(120_000),
    });

    let reducedPrices: ReducedPrice[];
    if (downloadUrl.endsWith('.jsonl.gz')) {
      console.log('🧩 Formato detectado: JSONL comprimido (.jsonl.gz). Parseando por stream...');
      reducedPrices = await parseJsonlGzFromResponse(res);
    } else {
      console.log('🧩 Formato detectado: JSON array clásico. Parseando en memoria...');
      const cards = (await res.json()) as ScryfallCard[];
      console.log(`⚙️ Procesando ${cards.length} cartas de Scryfall...`);
      reducedPrices = cards
        .map(mapPrice)
        .filter((value): value is ReducedPrice => value !== null);
    }

    // Asegurar directorio de salida
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(reducedPrices, null, 2), 'utf8');

    console.log(`\n✅ Proceso completado con éxito.`);
    console.log(`📊 Total de cartas con precios reales: ${reducedPrices.length}`);
    console.log(`💾 Archivo actualizado listo para el Frontend en: ${OUTPUT_FILE}`);
  } catch (err) {
    console.error('❌ Error catastrófico procesando precios de Scryfall:', err);
    process.exit(1);
  }
}

main();