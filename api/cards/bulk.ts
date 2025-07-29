import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'typesense';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const names: string[] = req.body?.names;
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing "names" in request body' });
  }

  const client = new Client({
    nodes: [
      {
        host: 'typesense-commanderscrapper.fly.dev',
        port: 443,
        protocol: 'https',
      },
    ],
    apiKey: 'typsensemasterkeyMariArri30123456789',
  });

  const results: any[] = [];
  const chunkSize = 20;

  for (let i = 0; i < names.length; i += chunkSize) {
    const batch = names.slice(i, i + chunkSize);
    console.log('🔍 Searching for:', batch);

    const searches = batch.map((name) => ({
      q: name,
      query_by: 'name',
      per_page: 1,
      num_typos: 0,
      prefix: 'false',
      exhaustive_search: true,
      collection: 'cards',         // necesario para Typesense
    }));

    const batchResults: {
      results: Array<{
        hits?: Array<{ document: { name: string; oracle_id: string; [key: string]: any } }>;
      }>;
    } = await client.multiSearch.perform({
      searches,
    });

    const seen = new Set();

    // Recorrer cada resultado y usar el índice para asociarlo a su búsqueda original
    for (let j = 0; j < batchResults.results.length; j++) {
      const hit = batchResults.results[j];
      const originalName = batch[j]; // obtener el nombre original

      const normalize = (str: string) =>
        str.toLowerCase().replace(/[\u2019’']/g, "'").trim();

      const match = hit.hits?.find(
        (h: any) => normalize(h.document.name) === normalize(originalName)
      );

      if (match && !seen.has(match.document.oracle_id)) {
        seen.add(match.document.oracle_id);
        results.push(match.document);
      } else if (!match) {
        console.error(`❌ Carta no encontrada en DB (bulk): "${originalName}"`);
      }
    }
  }

  return res.status(200).json(results);
}
