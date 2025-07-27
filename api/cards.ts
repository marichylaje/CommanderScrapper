import type { IncomingMessage, ServerResponse } from 'http';
import { Client } from 'typesense';

type VercelRequest = IncomingMessage & {
  query: { [key: string]: string | string[] };
};

type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
};

type Card = {
  oracle_id: string;
  cmc?: number;
  color_identity?: string[];
};

function deduplicateByOracleId(cards: Card[]): Card[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (!card.oracle_id) return false;
    if (seen.has(card.oracle_id)) return false;
    seen.add(card.oracle_id);
    return true;
  });
}

function filterCards(cards: Card[], queryParams: Record<string, string>) {
  const allowedIdentities = queryParams.identity
    ? queryParams.identity.split(',').map((s) => s.trim().toUpperCase())
    : [];

  return cards.filter((card) => {
    const passesCMC =
      !queryParams.cmc || Number(card.cmc) === Number(queryParams.cmc);

    const cardIdentity = (card.color_identity ?? []).join('').toUpperCase();

    const passesIdentity =
      allowedIdentities.length === 0 || allowedIdentities.includes(cardIdentity);

    return passesCMC && passesIdentity;
  });
}


export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  try {
    const client = new Client({
      nodes: [
        {
          host: 'typesense-commanderscrapper.fly.dev',
          port: 443,
          protocol: 'https',
        },
      ],
      apiKey: process.env.TYPESENSE_API_KEY!,
    });

    const q = req.query.q?.toString() || '*';

    const searchResult = await client
      .collections('cards')
      .documents()
      .search({
        q,
        query_by: 'name,type_line,oracle_text',
        per_page: 100,
      });

    const rawCards = (searchResult.hits ?? []).map((h: any) => h.document);

    const deduped = deduplicateByOracleId(rawCards);
    const filtered = filterCards(deduped, req.query as Record<string, string>);

    res.status(200).json(filtered);
  } catch (error: any) {
    console.error('💥 ERROR:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
