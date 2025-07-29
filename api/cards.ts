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
  try {
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

    const name = req.query.name?.toString().trim();

    if (!name) {
      return res.status(400).json({ error: 'Missing "name" query parameter' });
    }

    // 🔍 Buscar por "name"
    const results = await client
      .collections('cards')
      .documents()
      .search({
        q: name,
        query_by: 'name',
        per_page: 1,
        num_typos: 0,
        prefix: 'false',
        exhaustive_search: true,
      });

    const normalize = (s: string) =>
      s.toLowerCase().replace(/[\u2019’']/g, "'").trim();

    const exactMatch = results.hits?.find(
      (hit: any) => normalize(hit.document.name) === normalize(name)
    );

    if (exactMatch) {
      return res.status(200).json([exactMatch.document]);
    }

    // 🔁 Fallback por "face_name"
    const fallbackResults = await client
      .collections('cards')
      .documents()
      .search({
        q: name,
        query_by: 'face_name',
        per_page: 1,
        num_typos: 0,
        prefix: 'false',
        exhaustive_search: true,
      });

    const faceMatch = fallbackResults.hits?.find(
      (hit: any) => normalize(hit.document.face_name) === normalize(name)
    );

    if (faceMatch) {
      console.warn(`⚠️ Carta encontrada por face_name: "${name}"`);
      return res.status(200).json([faceMatch.document]);
    }

    console.error(`❌ Carta no encontrada en DB: "${name}"`);
    return res.status(404).json({ error: 'Card not found' });

  } catch (error: any) {
    console.error('💥 ERROR:', error.message, error.stack);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
