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

  const normalize = (str: string) =>
    str.toLowerCase().replace(/[\u2019’']/g, "'").trim();

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
      collection: 'cards',
    }));

    const batchResults = await client.multiSearch.perform({ searches });

    const seen = new Set();

    for (let j = 0; j < batchResults.results.length; j++) {
      const hit = batchResults.results[j];
      const originalName = batch[j];

      const exactMatch = hit.hits?.find(
        (h: any) => normalize(h.document.name) === normalize(originalName)
      );

      if (exactMatch && !seen.has(exactMatch.document.oracle_id)) {
        seen.add(exactMatch.document.oracle_id);
        results.push(exactMatch.document);
      } else {
        // Fallback: buscar por face_name
        try {
          const fallback = await client
            .collections('cards')
            .documents()
            .search({
              q: originalName,
              query_by: 'face_name',
              per_page: 1,
              num_typos: 0,
              prefix: 'false',
              exhaustive_search: true,
            });

          const faceMatch = fallback.hits?.find(
            (h: any) => normalize(h.document.face_name) === normalize(originalName)
          );

          if (
            faceMatch &&
            !seen.has((faceMatch.document as { oracle_id: string }).oracle_id)
          ) {
            seen.add((faceMatch.document as { oracle_id: string }).oracle_id);
            results.push(faceMatch.document);
            console.log(`🔁 Fallback por face_name exitoso para "${originalName}"`);
          } else {
            console.error(`❌ Carta no encontrada en DB (bulk): "${originalName}"`);
          }
        } catch (e) {
          console.error(`💥 Error en fallback de "${originalName}":`, e);
        }
      }
    }
  }

  return res.status(200).json(results);
}
