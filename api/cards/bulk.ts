import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'typesense';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const names: string[] = req.body?.names;
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing "names" in request body"' });
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
  const seen = new Set();
  const chunkSize = 20;

  const normalize = (str: string) =>
    str.toLowerCase().replace(/[\u2019’']/g, "'").trim();

  for (let i = 0; i < names.length; i += chunkSize) {
    const batch = names.slice(i, i + chunkSize);
    console.log('🔍 Searching for:', batch);

    const searches = batch.map((name) => ({
      q: name,
      query_by: 'name',
      per_page: 5, // más resultados para encontrar el match exacto
      num_typos: 0,
      prefix: 'false',
      exhaustive_search: true,
      collection: 'cards',
    }));

    const batchResults = await client.multiSearch.perform({ searches }) as {
      results: Array<{ hits?: any[]; [key: string]: any }>;
    };

    for (let j = 0; j < batchResults.results.length; j++) {
      const hits = batchResults.results[j]?.hits || [];
      const originalName = batch[j];

      const exact = hits.find(
        (hit: any) => normalize(hit.document.name) === normalize(originalName)
      );

      if (exact && !seen.has(exact.document.oracle_id)) {
        seen.add(exact.document.oracle_id);
        results.push(exact.document);
        continue;
      }

      // 🔁 Fallback por face_name si no hubo match exacto
      try {
        const fallback = await client
          .collections('cards')
          .documents()
          .search({
            q: originalName,
            query_by: 'face_name',
            per_page: 3,
            num_typos: 0,
            prefix: 'false',
            exhaustive_search: true,
          });

        const faceHit = fallback.hits?.find(
          (hit: any) =>
            normalize(hit.document.face_name) === normalize(originalName)
        );

        if (
          faceHit &&
          !seen.has((faceHit.document as { oracle_id: string }).oracle_id)
        ) {
          seen.add((faceHit.document as { oracle_id: string }).oracle_id);
          results.push(faceHit.document);
          console.warn(`⚠️ Carta encontrada por face_name: "${originalName}"`);
        } else {
          console.error(`❌ Carta no encontrada en DB (bulk): "${originalName}"`);
        }
      } catch (e) {
        console.error(`💥 Error en fallback de "${originalName}":`, e);
      }
    }
  }

  return res.status(200).json(results);
}
