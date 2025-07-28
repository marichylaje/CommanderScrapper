// api/cards/bulk.ts
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

   // Process in batches of 20 to avoid overload
  const chunkSize = 20;
  for (let i = 0; i < names.length; i += chunkSize) {
    const batch = names.slice(i, i + chunkSize);
    console.log('🔍 Searching for:', batch);

    const searches = batch.map((name) => ({
      q: name,
      query_by: 'name',
      per_page: 1,
      num_typos: 0,
      prefix: 'none',
      exhaustive_search: true,
    }));

    // Use the Typesense types directly or adjust to match the actual response
    type TypesenseMultiSearchResult = {
      results: Array<{
        hits?: Array<{ document: any }>;
        [key: string]: any;
      }>;
    };

    const batchResults: TypesenseMultiSearchResult = await client.multiSearch.perform({
      searches,
    });
    const seen = new Set();
    for (const hit of batchResults.results) {
        const normalize = (str: string) => str.toLowerCase().replace(/[\u2019']/g, "'").trim();
        const match = hit.hits?.find(
            (h: any) => normalize(h.document.name) === normalize(hit.query)
        );

        if (match && !seen.has(match.document.oracle_id)) {
            seen.add(match.document.oracle_id);
            results.push(match.document);
        }
    }
    console.log('📦 Results:', JSON.stringify(batchResults, null, 2));

  }

  return res.status(200).json(results);
}

