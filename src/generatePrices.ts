// generatePrices.ts
import fs from 'fs';
import path from 'path';
import { fetch } from 'undici';

const SCRYFALL_BULK_INFO_URL = 'https://api.scryfall.com/bulk-data';
const OUTPUT_FILE = './data/reduced-prices.json';

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

async function getBulkDownloadUrl(): Promise<string> {
  const res = await fetch(SCRYFALL_BULK_INFO_URL);
  if (!res.ok) throw new Error(`❌ No se pudo obtener la metadata de Scryfall Bulk: ${res.status}`);
  
  const body = (await res.json()) as { data: Array<{ type: string; download_uri: string }> };
  // "oracle_cards" contiene una fila por cada carta única por nombre (evita duplicados de reimpresiones)
  const oracleCardsBulk = body.data.find((item) => item.type === 'oracle_cards');
  
  if (!oracleCardsBulk) throw new Error('❌ No se encontró el tipo de datos "oracle_cards" en Scryfall');
  return oracleCardsBulk.download_uri;
}

async function main() {
  try {
    console.log('🔍 Solicitando URL del último Bulk Data a Scryfall...');
    const downloadUrl = await getBulkDownloadUrl();
    
    console.log(`📥 Descargando e interpretando Bulk Data desde: ${downloadUrl}`);
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`❌ Error al descargar el archivo bulk: ${res.status}`);

    // Parseamos el JSON masivo de Scryfall
    const cards = (await res.json()) as ScryfallCard[];
    console.log(`⚙️ Procesando ${cards.length} cartas de Scryfall...`);

    const reducedPrices: ReducedPrice[] = [];

    for (const card of cards) {
      if (!card.oracle_id) continue;

      // Scryfall nos da los precios directamente en strings o nulls
      // Priorizamos precios normales, pero si no existen, podrías usar foil como fallback opcional.
      const usdPrice = card.prices.usd ? parseFloat(card.prices.usd) : null;
      const eurPrice = card.prices.eur ? parseFloat(card.prices.eur) : null;

      // Solo guardamos cartas que tengan al menos un precio válido mapeado
      if (usdPrice !== null || eurPrice !== null) {
        reducedPrices.push({
          id: card.oracle_id,
          usd: usdPrice,
          eur: eurPrice,
        });
      }
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