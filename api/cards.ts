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

function parseScryfallLikeQueryToTypesense(q: string): string {
  return q
    .replace(/AND/g, '&&')
    .replace(/OR/g, '||')
    .replace(/type:([^\s()]+)/g, 'type_line:$1')         // type:creature → type_line:creature
    .replace(/oracle:([^\s()]+)/g, 'oracle_text:$1')     // oracle:foo → oracle_text:foo
    .replace(/name:([^\s()]+)/g, 'name:$1')              // name:foo → name:foo (ya OK)
    .replace(/\(\(([^)]+)\)\)/g, '($1)')                 // dobles paréntesis innecesarios
    .replace(/\(([^()]*:[^()]+)\)/g, '$1')               // limpiar paréntesis simples
    .replace(/"/g, '')                                   // quitar comillas
    .replace(/cmc=([0-9]+)/g, 'cmc:=$1')
    .replace(/cmc>=([0-9]+)/g, 'cmc:>=$1')
    .replace(/rarity:([^\s()]+)/g, 'rarity:$1')
    .replace(/identity=([WUBRG]+)/g, 'color_identity:$1'); // puede mejorarse aún más
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
      apiKey: 'typsensemasterkeyMariArri30123456789', // reemplázala si hace falta
    });

    const rawQuery = req.query.q?.toString() || '*';
    const q = parseScryfallLikeQueryToTypesense(rawQuery);

    const results = await client
      .collections('cards')
      .documents()
      .search({
        q,
        query_by: 'name,type_line,oracle_text',
        per_page: 50,
      });

    return res.status(200).json((results.hits ?? []).map((h: any) => h.document));
  } catch (error: any) {
    console.error('💥 ERROR:', error.message, error.stack);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
