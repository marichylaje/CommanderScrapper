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
const PRINTING_OUTPUT_FILE = './data/printing-prices.json';
const CARDMARKET_GUIDE_URL =
  'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json';
const SCRYFALL_HEADERS = {
  'User-Agent': 'CommanderScrapper/1.0 (MTG Commander Deck Builder app; contact via GitHub)',
  Accept: 'application/json',
};

interface ScryfallCard {
  id?: string;
  oracle_id: string;
  cardmarket_id?: number | null;
  set?: string;
  collector_number?: string;
  finishes?: string[];
  digital?: boolean;
  prices: {
    usd: string | null;
    eur: string | null;
    usd_foil?: string | null;
    eur_foil?: string | null;
  };
}

type CardmarketLow = { low: number | null; lowFoil: number | null };
type CardmarketGuide = Map<number, CardmarketLow>;

// [eurLowCents, eurLowFoilCents, usdCents, usdFoilCents, finishes (1 nonfoil, 2 foil, 4 etched)]
type PrintingPrice = [number | null, number | null, number | null, number | null, number];

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

function pickBulkUrl(item: ScryfallBulkMetaItem, type: string): string {
  const candidate = item.jsonl_download_uri ?? item.download_uri;
  if (!candidate || typeof candidate !== 'string') {
    throw new Error(`❌ Scryfall no entregó una URL de descarga utilizable para ${type}.`);
  }
  return candidate;
}

async function getBulkDownloadUrl(type: 'default_cards' | 'oracle_cards'): Promise<string> {
  const res = await fetchWithRetry(SCRYFALL_BULK_INFO_URL, {
    headers: SCRYFALL_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  
  const body = (await res.json()) as { data?: ScryfallBulkMetaItem[] };
  if (!Array.isArray(body.data)) {
    throw new Error('❌ Metadata de Scryfall inválida: no llegó el arreglo "data".');
  }

  // "oracle_cards" contiene una fila por cada carta única por nombre (evita duplicados de reimpresiones)
  const bulk = body.data.find((item) => item.type === type);
  
  if (!bulk) throw new Error(`❌ No se encontró el tipo de datos "${type}" en Scryfall`);
  return pickBulkUrl(bulk, type);
}

function maybeParseNumber(price: string | null | undefined): number | null {
  if (!price) return null;
  const parsed = Number.parseFloat(price);
  return Number.isFinite(parsed) ? parsed : null;
}

function positivePrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

const toCents = (value: number | null) => (value === null ? null : Math.round(value * 100));

// El `low` de Cardmarket no está en Scryfall; se cruza por cardmarket_id (idProduct).
async function loadCardmarketGuide(): Promise<CardmarketGuide> {
  const res = await fetchWithRetry(CARDMARKET_GUIDE_URL, { signal: AbortSignal.timeout(120_000) });
  const body = (await res.json()) as {
    priceGuides?: Array<Record<string, number | null> & { idProduct: number }>;
  };
  if (!Array.isArray(body.priceGuides) || body.priceGuides.length < 1000) {
    throw new Error('❌ Price guide de Cardmarket inválido o incompleto.');
  }
  const guide: CardmarketGuide = new Map();
  for (const row of body.priceGuides) {
    guide.set(row.idProduct, { low: positivePrice(row.low), lowFoil: positivePrice(row['low-foil']) });
  }
  return guide;
}

function mapPrice(card: ScryfallCard, guide: CardmarketGuide): ReducedPrice | null {
  if (!card.oracle_id) return null;

  const usdPrice = maybeParseNumber(card.prices?.usd);
  const cardmarket = card.cardmarket_id ? guide.get(card.cardmarket_id) : undefined;
  const eurPrice = cardmarket?.low ?? maybeParseNumber(card.prices?.eur);

  if (usdPrice === null && eurPrice === null) {
    return null;
  }

  return {
    id: card.oracle_id,
    usd: usdPrice,
    eur: eurPrice,
  };
}

function finishBits(card: ScryfallCard): number {
  const finishes = card.finishes ?? [];
  return (finishes.includes('nonfoil') ? 1 : 0) | (finishes.includes('foil') ? 2 : 0) |
    (finishes.includes('etched') ? 4 : 0);
}

function mapPrintingPrice(card: ScryfallCard, guide: CardmarketGuide): PrintingPrice | null {
  if (card.digital || !card.set || !card.collector_number) return null;
  const cardmarket = card.cardmarket_id ? guide.get(card.cardmarket_id) : undefined;
  const entry: PrintingPrice = [
    toCents(cardmarket?.low ?? maybeParseNumber(card.prices?.eur)),
    toCents(cardmarket?.lowFoil ?? maybeParseNumber(card.prices?.eur_foil)),
    toCents(maybeParseNumber(card.prices?.usd)),
    toCents(maybeParseNumber(card.prices?.usd_foil)),
    finishBits(card),
  ];
  return entry.slice(0, 4).some((value) => value !== null) || entry[4] === 2 ? entry : null;
}

async function streamBulkCards(res: UndiciResponse, onCard: (card: ScryfallCard) => void): Promise<void> {
  if (!res.body) {
    throw new Error('❌ La respuesta de Scryfall no contiene body para stream.');
  }

  const input = Readable.fromWeb(res.body as any);
  const gunzip = zlib.createGunzip();
  const lineReader = readline.createInterface({
    input: input.pipe(gunzip),
    crlfDelay: Infinity,
  });

  let processed = 0;

  for await (const line of lineReader) {
    if (!line || !line.trim()) continue;
    try {
      onCard(JSON.parse(line) as ScryfallCard);
      processed++;
      if (processed % 100_000 === 0) {
        console.log(`⚙️ Procesadas ${processed.toLocaleString()} cartas...`);
      }
    } catch {
      // Ignoramos líneas corruptas puntuales para no tumbar todo el proceso
    }
  }
}

async function downloadBulk(type: 'default_cards' | 'oracle_cards'): Promise<UndiciResponse> {
  const downloadUrl = await getBulkDownloadUrl(type);
  if (!downloadUrl.endsWith('.jsonl.gz')) {
    throw new Error(`❌ Scryfall ${type} no ofrece JSONL comprimido: ${downloadUrl}`);
  }
  console.log(`📥 Descargando ${type} desde: ${downloadUrl}`);
  return fetchWithRetry(downloadUrl, { headers: SCRYFALL_HEADERS, signal: AbortSignal.timeout(300_000) });
}

async function main() {
  try {
    console.log('💶 Descargando price guide de Cardmarket (low)...');
    const guide = await loadCardmarketGuide();
    console.log(`✅ ${guide.size.toLocaleString()} productos de Cardmarket cargados.`);

    const reducedPrices: ReducedPrice[] = [];
    await streamBulkCards(await downloadBulk('oracle_cards'), (card) => {
      const mapped = mapPrice(card, guide);
      if (mapped) reducedPrices.push(mapped);
    });

    // Cardmarket usa el mismo producto para todos los idiomas: la clave es idioma-independiente.
    const printings: Record<string, PrintingPrice> = {};
    await streamBulkCards(await downloadBulk('default_cards'), (card) => {
      const entry = mapPrintingPrice(card, guide);
      const key = `${card.set}/${card.collector_number}`;
      if (entry && !printings[key]) printings[key] = entry;
    });

    if (reducedPrices.length < 1000 || Object.keys(printings).length < 1000) {
      throw new Error('❌ Dataset de precios sospechosamente pequeño; no se sobrescribe.');
    }
    const sortedPrintings = Object.fromEntries(
      Object.entries(printings).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );

    // Asegurar directorio de salida
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(reducedPrices, null, 2), 'utf8');
    fs.writeFileSync(
      PRINTING_OUTPUT_FILE,
      JSON.stringify({ version: 1, source: 'cardmarket-low+scryfall', prices: sortedPrintings }),
      'utf8',
    );

    console.log(`\n✅ Proceso completado con éxito.`);
    console.log(`📊 Total de cartas con precios reales: ${reducedPrices.length}`);
    console.log(`📊 Impresiones con precio: ${Object.keys(sortedPrintings).length}`);
    console.log(`💾 Archivos listos para el Frontend: ${OUTPUT_FILE}, ${PRINTING_OUTPUT_FILE}`);
  } catch (err) {
    console.error('❌ Error catastrófico procesando precios de Scryfall:', err);
    process.exit(1);
  }
}

main();