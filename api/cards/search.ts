import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'typesense';
import { applyCors, handleCorsPreflight } from '../_lib/cors.js';


export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
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

    let hits: any[] = [];
    let found = 0;
    let hasMore = false;

    // 1. Usar Typesense local si y sÃ³lo si se busca un comandante especÃ­fico (optimizaciÃ³n extrema)
    if (isCommander) {
      try {
        const client = new Client({
          nodes: [{ host: 'typesense-commanderscrapper.fly.dev', port: 443, protocol: 'https' }],
          apiKey: 'typsensemasterkeyMariArri30123456789',
        });

        const filters: string[] = [];
        filters.push('type_line:Legendary AND (type_line:Creature OR type_line:Planeswalker)');
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
        hits = results.hits?.map((hit: any) => hit.document) || [];

        if (cn) {
          hits = hits.filter((doc: any) => doc.collector_number === cn);
        }

        found = results.found ?? 0;
        hasMore = (page * perPage) < found;
      } catch (err: any) {
        console.warn('âš ï¸ Typesense local search failed, falling back to Scryfall:', err.message);
      }
    }

    // 2. Si no es comandante, o si no dio resultados en Typesense, consultar Scryfall de forma directa
    if (hits.length === 0) {
      try {
        let scryfallQuery = q;
        if (isCommander) {
          scryfallQuery = `is:commander ${q}`;
        }
        if (set) {
          scryfallQuery = `set:${set} ${scryfallQuery}`;
        }
        
        const scryfallRes = await fetch(
          `https://api.scryfall.com/cards/search?q=${encodeURIComponent(scryfallQuery)}&page=${page}`
        );

        if (scryfallRes.ok) {
          const scryfallData = (await scryfallRes.json()) as { data: any[]; has_more?: boolean; total_cards?: number };
          if (scryfallData?.data) {
            hits = scryfallData.data.filter(
              (doc: any) => doc && doc.id && doc.object !== 'error'
            );
            if (cn) {
              hits = hits.filter((doc: any) => doc.collector_number === cn);
            }
            found = scryfallData.total_cards ?? hits.length;
            hasMore = scryfallData.has_more ?? false;
          }
        }
      } catch (err: any) {
        console.error('âŒ Scryfall search query failed:', err.message);
      }
    }

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
    console.error('ðŸ’¥ ERROR in /api/cards/search:', error.message, error.stack);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}



