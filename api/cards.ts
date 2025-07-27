// api/cards.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'typesense';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const client = new Client({
      nodes: [
        {
          host: 'typesense-commanderscrapper.fly.dev',
          port: 443,
          protocol: 'https',
        },
      ],
      apiKey: 'typsensemasterkeyMariArri30123456789', // reemplázala si hace falta
    });

    const q = req.query.q?.toString() || '*';

    const results = await client
      .collections('cards')
      .documents()
      .search({
        q,
        query_by: 'name,type_line,oracle_text',
        per_page: 5,
      });

    return res.status(200).json((results.hits ?? []).map((h: any) => h.document));
  } catch (error: any) {
    console.error('💥 ERROR:', error.message, error.stack);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
