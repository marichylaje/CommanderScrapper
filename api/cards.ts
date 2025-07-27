import { Client } from 'typesense';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const client = new Client({
    nodes: [
      {
        host: 'typesense-commanderscrapper.fly.dev',
        port: 443,
        protocol: 'https',
      },
    ],
    apiKey: 'typsensemasterkeyMariArri30123456789', // temporalmente hardcodeada
  });

  const q = req.query.q?.toString() || '*';
  const color = req.query.color?.toString();
  const type = req.query.type?.toString();

  const filterBy = [];
  if (color) filterBy.push(`color_identity:=[${color}]`);
  if (type) filterBy.push(`type_line:=${type}`);

  try {
    const results = await client
      .collections('cards')
      .documents()
      .search({
        q,
        query_by: 'name,type_line,oracle_text',
        per_page: 25,
        filter_by: filterBy.join(' && '),
      });

    return res.status(200).json((results.hits ?? []).map((hit: any) => hit.document));
  } catch (error: any) {
    console.error('❌ Error buscando en Typesense:', error.message, error.stack);
    return res.status(500).json({ error: 'Error al buscar cartas' });
  }
}
