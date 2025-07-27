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

function parseScryfallToFilterBy(query: string): string {
  const filters: string[] = [];

  const cmcMatch = query.match(/cmc=([0-9]+)/);
  if (cmcMatch) filters.push(`cmc:=${cmcMatch[1]}`);

  const rarityMatch = query.match(/rarity=([a-zA-Z]+)/);
  if (rarityMatch) filters.push(`rarity:=${rarityMatch[1]}`);

  const typeMatch = query.match(/type:([a-zA-Z]+)/);
  if (typeMatch) filters.push(`type_line:=${typeMatch[1]}`);

    const identityMatches = [...query.matchAll(/identity=([WUBRG]+)/g)];
    if (identityMatches.length > 0) {
    const allColors = new Set<string>();
    for (const match of identityMatches) {
        match[1].split('').forEach((c) => allColors.add(c));
    }
    filters.push(`color_identity:=[${[...allColors].join(',')}]`);
    }

  return filters.join(' && ');
}

function parseQueryTextualPart(query: string): string {
  const parts: string[] = [];

  const nameMatch = query.match(/name:"?([a-zA-Z0-9\s']+)"?/);
  if (nameMatch) parts.push(nameMatch[1]);

  const oracleMatch = query.match(/oracle:"?([a-zA-Z0-9\s']+)"?/);
  if (oracleMatch) parts.push(oracleMatch[1]);

  const typeTextMatch = query.match(/type:"?([a-zA-Z0-9\s']+)"?/);
  if (typeTextMatch) parts.push(typeTextMatch[1]);

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

    const rawQuery = req.query.q?.toString() || '';
    const filter_by = parseScryfallToFilterBy(rawQuery);
    const q = parseQueryTextualPart(rawQuery);

    const searchParams: any = {
      q,
      query_by: 'name,type_line,oracle_text',
      per_page: 50,
    };

    if (filter_by) {
      searchParams.filter_by = filter_by;
    }

    // Si la query contiene name:"...", activamos búsqueda más precisa
    if (/name:"/.test(rawQuery)) {
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
