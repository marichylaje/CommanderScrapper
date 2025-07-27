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

// 👉 Esta función separa partes de la query que van en `q` y otras en `filter_by`
function parseQuery(query: string): { q: string; filter_by: string } {
  let qParts: string[] = [];
  let filters: string[] = [];

  // Remover comillas innecesarias para facilitar parsing
  query = query.replace(/"/g, '');

  // Separar por AND y OR preservando paréntesis
  const tokens = query.match(/(\(|\)|AND|OR|[^()\s]+)/g) || [];

  let currentExpr = '';

  for (let token of tokens) {
    if (token === 'AND' || token === 'OR' || token === '(' || token === ')') {
      currentExpr += ` ${token} `;
      continue;
    }

    // Match filtros conocidos
    if (token.startsWith('type:')) {
      const val = token.slice(5);
      currentExpr += ` type_line:=${val} `;
    } else if (token.startsWith('oracle:')) {
      const val = token.slice(7);
      qParts.push(val); // se buscará en oracle_text
    } else if (token.startsWith('name:')) {
      const val = token.slice(5);
      qParts.push(val); // se buscará en name
    } else if (token.startsWith('cmc=')) {
      const val = token.slice(4);
      currentExpr += ` cmc:=${val} `;
    } else if (token.startsWith('cmc>=')) {
      const val = token.slice(5);
      currentExpr += ` cmc:>={val} `;
    } else if (token.startsWith('rarity:')) {
      const val = token.slice(7);
      currentExpr += ` rarity:=${val} `;
    } else if (token.startsWith('identity=')) {
      const val = token.slice(9);
      currentExpr += ` color_identity:=${val} `;
    } else {
      qParts.push(token);
    }
  }

  return {
    q: qParts.join(' ').trim() || '*',
    filter_by: currentExpr.replace(/\s+/g, ' ').trim(),
  };
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

    const rawQuery = req.query.q?.toString() || '*';
    const { q, filter_by } = parseQuery(rawQuery);

    const results = await client
      .collections('cards')
      .documents()
      .search({
        q,
        query_by: 'name,oracle_text',
        per_page: 50,
        filter_by,
      });

    return res.status(200).json((results.hits ?? []).map((h: any) => h.document));
  } catch (error: any) {
    console.error('💥 ERROR:', error.message, error.stack);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
