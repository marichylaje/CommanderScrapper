import type { IncomingMessage, ServerResponse } from 'http';
import { Client } from 'typesense';

type VercelRequest = IncomingMessage & {
  query: { [key: string]: string | string[] };
};

type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
};

// 🔧 Construye el filtro para Typesense
function buildFilterFromParams(params: Record<string, string | string[]>): string {
  const filters: string[] = [];

  if (params.cmc) filters.push(`cmc:=${params.cmc}`);
  if (params.rarity) filters.push(`rarity:=${params.rarity}`);
  if (params.type) filters.push(`type_line:=${params.type}`);

  const identity = params.identity;
  if (identity) {
    const identities = Array.isArray(identity) ? identity : [identity];
    const colorLetters = [...new Set(identities.join('').split(''))]; // "GR" => ["G", "R"]
    filters.push(`color_identity:contains:[${colorLetters.join(',')}]`);
  }

  if (params.name) {
    filters.push(`name:~${params.name}`);
  }

  return filters.join(' && ');
}

// 🔍 Construye el campo q para búsqueda textual
function buildTextQuery(params: Record<string, string | string[]>): string {
  const parts: string[] = [];

  if (typeof params.oracle === 'string') parts.push(params.oracle);
  if (typeof params.type === 'string') parts.push(params.type);
  if (typeof params.name === 'string') parts.push(params.name);

  return parts.join(' ').trim() || '*';
}

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

    const params = req.query as Record<string, string | string[]>;

    const filter_by = buildFilterFromParams(params);
    const q = buildTextQuery(params);

    const searchParams: any = {
      q,
      query_by: 'name,type_line,oracle_text',
      per_page: 50,
    };

    if (filter_by) {
      searchParams.filter_by = filter_by;
    }

    if (params.name) {
      searchParams.prefix = 'middle';
      searchParams.num_typos = 0;
    }

    const results = await client
      .collections('cards')
      .documents()
      .search(searchParams);

    const unique = new Map();
    (results.hits ?? []).forEach((h: any) => {
      unique.set(h.document.oracle_id, h.document);
    });

    return res.status(200).json(Array.from(unique.values()));
  } catch (error: any) {
    console.error('💥 ERROR:', error.message, error.stack);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
