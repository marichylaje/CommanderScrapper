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
    const identities = identityMatches.map((m) => m[1]);
    filters.push(`color_identity:=[${identities.join(',')}]`);
  }

  const nameMatch = query.match(/name:"?([a-zA-Z0-9\s']+)"?/);
    if (nameMatch) {
    filters.push(`name:~${nameMatch[1]}`); // usa substring match
    }

  return filters.join(' && ');
}

function parseQueryTextualPart(query: string): string {
  // Esto busca coincidencias en campos como name/oracle/type para el `q` textual
  const oracleMatch = query.match(/oracle:"?([a-zA-Z0-9\s']+)"?/);
  const typeMatch = query.match(/type:"?([a-zA-Z0-9\s']+)"?/);

  const parts = [];
  if (oracleMatch) parts.push(oracleMatch[1]);
  if (typeMatch) parts.push(typeMatch[1]);

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
    const filters = parseScryfallToFilterBy(rawQuery);

    // Buscar name:"traxa" como substring exacto dentro del nombre
    const nameMatch = rawQuery.match(/name:"?([a-zA-Z0-9\s']+)"?/);
    const q = nameMatch ? nameMatch[1].toLowerCase() : '*';

    const results = await client
      .collections('cards')
      .documents()
      .search({
        q,
        query_by: 'name',
        filter_by: filters,
        per_page: 50,
        prefix: 'middle',       // 🔑 Permite "traxa" ⊆ "Atraxa"
        num_typos: 0            // 🔒 Coincidencia exacta, sin errores
      });

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
