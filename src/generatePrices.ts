import fs from 'fs';
import { fetch } from 'undici';
import { parse } from 'csv-parse/sync';

const PRICES_CSV_URL = 'https://mtgjson.com/api/v5/csv/cardPrices.csv';
const IDENTIFIERS_CSV_URL = 'https://mtgjson.com/api/v5/csv/cardIdentifiers.csv';
const OUTPUT_FILE = './data/reduced-prices.json';

interface PriceRow {
  uuid: string;
  priceProvider: string;
  currency: string;
  price: string;
}

interface IdentifierRow {
  uuid: string;
  scryfallOracleId: string;
}

interface ReducedPrice {
  id: string;
  usd: number | null;
  eur: number | null;
}

async function fetchAndParseCSV(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`❌ Error al descargar CSV: ${url} (${res.status})`);
  const csvText = await res.text();
  return parse(csvText, { columns: true, skip_empty_lines: true });
}

async function main() {
  try {
    console.log('📥 Descargando CSVs...');
    const [priceRowsRaw, identifierRowsRaw] = await Promise.all([
      fetchAndParseCSV(PRICES_CSV_URL),
      fetchAndParseCSV(IDENTIFIERS_CSV_URL),
    ]);

    const priceRows = priceRowsRaw as PriceRow[];
    const identifierRows = identifierRowsRaw as IdentifierRow[];

    // Crear mapa uuid → scryfallOracleId
    const uuidToOracleId = new Map<string, string>();
    for (const row of identifierRows) {
      if (row.uuid && row.scryfallOracleId) {
        uuidToOracleId.set(row.uuid, row.scryfallOracleId);
      }
    }

    // Crear mapa oracleId → { usd, eur }
    const pricesMap = new Map<string, ReducedPrice>();

    for (const row of priceRows) {
      const uuid = row.uuid;
      const oracleId = uuidToOracleId.get(uuid);
      if (!oracleId) continue;

      const price = parseFloat(row.price);
      if (isNaN(price)) continue;

      const existing = pricesMap.get(oracleId) ?? { id: oracleId, usd: null, eur: null };

      if (row.priceProvider === 'tcgplayer' && row.currency === 'USD') {
        existing.usd = price;
      }

      if (row.priceProvider === 'cardmarket' && row.currency === 'EUR') {
        existing.eur = price;
      }

      pricesMap.set(oracleId, existing);
    }

    const reduced = Array.from(pricesMap.values()).filter(
      (entry) => entry.usd !== null || entry.eur !== null
    );
    
    fs.mkdirSync('./data', { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(reduced, null, 2), 'utf8');

    console.log(`✅ ${reduced.length} precios procesados.`);
    console.log(`💾 Archivo guardado en: ${OUTPUT_FILE}`);
  } catch (err) {
    console.error('❌ Error procesando datos:', err);
  }
}

main();
