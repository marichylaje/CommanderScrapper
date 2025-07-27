import { MeiliSearch } from 'meilisearch';
import 'dotenv/config'
import * as fs from 'fs';

const client = new MeiliSearch({
  host: process.env.MEILI_HOST!,
  apiKey: process.env.MEILI_MASTER_KEY!,
});

async function main() {
  const file = fs.readFileSync('./data/scryfall-reduced.json', 'utf8');
  const json = JSON.parse(file);
  const cards = json.cards;

  const index = client.index('cards');

  await index.updateSettings({
    searchableAttributes: ['name', 'oracle_text'],
    filterableAttributes: ['colors', 'rarity', 'cmc', 'type_line'],
  });

  const { taskUid } = await index.addDocuments(cards);
  console.log(`✅ Enviados ${cards.length} documentos con task UID: ${taskUid}`);
}

main();
