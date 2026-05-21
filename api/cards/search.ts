import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'typesense';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const q = req.query.q?.toString().trim();
    if (!q) {
      return res.status(200).json({ data: [], has_more: false });
    }

    const page = parseInt(req.query.page?.toString() || '1', 10);
    const perPage = Math.min(parseInt(req.query.per_page?.toString() || '20', 10), 100);
    const isCommander = req.query.is_commander === 'true';
    const set = req.query.set?.toString().trim();
    const cn = req.query.cn?.toString().trim();

    const client = new Client({
      nodes: [{ host: 'typesense-commanderscrapper.fly.dev', port: 443, protocol: 'https' }],
      apiKey: 'typsensemasterkeyMariArri30123456789',
    });

    const filters: string[] = [];

    if (isCommander) {
      filters.push('type_line:Legendary AND (type_line:Creature OR type_line:Planeswalker)');
    }

    if (set) {
      filters.push(`set:${set.toLowerCase()}`);
    }

    const searchParams: any = {
      q,
      query_by: 'name,face_name,flavor_name',
      per_page: perPage,
      page,
      num_typos: 1,
      prefix: 'true',
    };

    if (filters.length > 0) {
      searchParams.filter_by = filters.join(' AND ');
    }

    const results = await client.collections('cards').documents().search(searchParams);

    let hits = results.hits?.map((hit: any) => hit.document) || [];

    // Si viene collector number, filtramos en JS ya que no es un campo indexado en el schema de Typesense
    if (cn) {
      hits = hits.filter((doc: any) => doc.collector_number === cn);
    }

    const found = results.found ?? 0;
    const hasMore = (page * perPage) < found;

    const nextUrlParams = new URLSearchParams();
    nextUrlParams.append('q', q);
    nextUrlParams.append('page', (page + 1).toString());
    nextUrlParams.append('per_page', perPage.toString());
    if (isCommander) nextUrlParams.append('is_commander', 'true');
    if (set) nextUrlParams.append('set', set);
    if (cn) nextUrlParams.append('cn', cn);

    const next_page = hasMore ? `/api/cards/search?${nextUrlParams.toString()}` : undefined;

    return res.status(200).json({
      data: hits,
      has_more: hasMore,
      next_page,
    });
  } catch (error: any) {
    console.error('💥 ERROR in /api/cards/search:', error.message, error.stack);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
