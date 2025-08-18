// scripts/tryGetCard.ts
import { Client } from 'typesense';
import 'dotenv/config';

const CARD_NAME = 'Spring // Mind'
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY;
if (!TYPESENSE_API_KEY) {
  console.error('❌ Falta TYPESENSE_API_KEY en .env');
  process.exit(1);
}

const normalize = (s: string) =>
  (s ?? '').toLowerCase().replace(/[\u2019’']/g, "'").normalize('NFKC').trim();

async function searchByField(client: Client, q: string, field: 'name' | 'face_name' | 'flavor_name') {
  const res = await client.collections('cards').documents().search({
    q,
    query_by: field,
    per_page: 5,
    num_typos: 0,
    prefix: 'false',
    exhaustive_search: true,
    // sort_by: 'released_at:desc', // opcional si tenéis el campo sortable
  });
  const hit = res.hits?.find(h => normalize(h.document[field] ?? '') === normalize(q));
  return hit?.document ?? null;
}

async function main() {
  const toFind = process.argv[2] || CARD_NAME;
  const client = new Client({
    nodes: [{ host: 'typesense-commanderscrapper.fly.dev', port: 443, protocol: 'https' }],
    apiKey: TYPESENSE_API_KEY!,
  });

  console.log(`🔎 Buscando "${toFind}" ...`);

  // 1) name
  let doc = await searchByField(client, toFind, 'name');
  if (doc) {
    console.log('✅ Encontrada por "name"');
  } else {
    // 2) face_name
    doc = await searchByField(client, toFind, 'face_name');
    if (doc) {
      console.log('✅ Encontrada por "face_name"');
    } else {
      // 3) flavor_name
      doc = await searchByField(client, toFind, 'flavor_name');
      if (doc) {
        console.log('✅ Encontrada por "flavor_name"');
      }
    }
  }

  if (!doc) {
    console.error('❌ No se encontró ningún documento para:', toFind);
    process.exit(2);
  }

  // Resumen útil
  console.log('— Resumen —');
  console.log({
    oracle_id: doc.oracle_id,
    name: doc.name,
    face_name: doc.face_name ?? null,
    flavor_name: doc.flavor_name ?? null,
    set: doc.set,
    released_at: doc.released_at,
  });

  // Documento completo
  console.log('— Documento —');
  console.log(JSON.stringify(doc, null, 2));
}

main().catch(err => {
  console.error('💥 Error:', err);
  process.exit(1);
});
