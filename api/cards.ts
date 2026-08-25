import { applyCors, handleCorsPreflight } from './_lib/cors.js';
// api/cards.ts
import type { IncomingMessage, ServerResponse } from 'http';
import { Client } from 'typesense';

type VercelRequest = IncomingMessage & {
  query: { [key: string]: string | string[] };
};

type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    const client = new Client({
      nodes: [
        {
          host: 'typesense-commanderscrapper.fly.dev',
          port: 443,
          protocol: 'https',
        },
      ],
      apiKey: 'typsensemasterkeyMariArri30123456789', // TODO: mover a secrets
    });

    const name = req.query.name?.toString().trim();

    if (!name) {
      return res.status(400).json({ error: 'Missing "name" query parameter' });
    }

    const normalize = (s: string) =>
      (s ?? '').toLowerCase().replace(/[\u2019â€™']/g, "'").normalize('NFKC').trim();

    // 1) Buscar por "name"
    const results = await client.collections('cards').documents().search({
      q: name,
      query_by: 'name',
      per_page: 1,
      num_typos: 0,
      prefix: 'false',
      exhaustive_search: true,
      // sort_by: 'released_at:desc', // opcional: hace determinista la versiÃ³n elegida
    });

    const exactMatch = results.hits?.find(
      (hit: any) => normalize(hit.document.name) === normalize(name)
    );

    if (exactMatch) {
      return res.status(200).json([exactMatch.document]);
    }

    // 2) Fallback por "face_name"
    const fallbackResults = await client.collections('cards').documents().search({
      q: name,
      query_by: 'face_name',
      per_page: 1,
      num_typos: 0,
      prefix: 'false',
      exhaustive_search: true,
      // sort_by: 'released_at:desc',
    });

    const faceMatch = fallbackResults.hits?.find(
      (hit: any) => normalize(hit.document.face_name ?? '') === normalize(name)
    );

    if (faceMatch) {
      console.warn(`âš ï¸ Carta encontrada por face_name: "${name}"`);
      return res.status(200).json([faceMatch.document]);
    }

    // 3) Fallback final por "flavor_name" (solo ese campo)
    const flavorResults = await client.collections('cards').documents().search({
      q: name,
      query_by: 'flavor_name',
      per_page: 1,
      num_typos: 0,
      prefix: 'false',
      exhaustive_search: true,
      // sort_by: 'released_at:desc',
    });

    const flavorMatch = flavorResults.hits?.find(
      (hit: any) => normalize(hit.document.flavor_name ?? '') === normalize(name)
    );

    if (flavorMatch) {
      console.warn(`âš ï¸ Carta encontrada por flavor_name: "${name}"`);
      return res.status(200).json([flavorMatch.document]);
    }

    // ðŸ” Fallback final por "face_flavor_names"
    const faceFlavorResults = await client
      .collections('cards')
      .documents()
      .search({
        q: name,
        query_by: 'face_flavor_names',
        per_page: 1,
        num_typos: 0,
        prefix: 'false',
        exhaustive_search: true,
      });

    const ffMatch = faceFlavorResults.hits?.find(
      (hit: any) => normalize((hit.document.face_flavor_names ?? []).join('|')).split('|')
                        .includes(normalize(name))
    );

    if (ffMatch) {
      console.warn(`âš ï¸ Carta encontrada por face_flavor_names: "${name}"`);
      return res.status(200).json([ffMatch.document]);
    }

    console.error(`âŒ Carta no encontrada en DB: "${name}"`);
    return res.status(404).json({ error: 'Card not found' });

  } catch (error: any) {
    console.error('ðŸ’¥ ERROR:', error.message, error.stack);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}



