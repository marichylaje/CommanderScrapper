// createTypesenseSchema.ts
import { Client } from 'typesense';
import type { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections';
import 'dotenv/config'; // 👈 Carga las variables automáticamente desde .env

const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY;

if (!TYPESENSE_API_KEY) {
  throw new Error('❌ Falta la variable de entorno TYPESENSE_API_KEY');
}

const client = new Client({
  nodes: [
    {
      host: 'typesense-commanderscrapper.fly.dev',
      port: 443,
      protocol: 'https',
    },
  ],
  apiKey: TYPESENSE_API_KEY!,
  connectionTimeoutSeconds: 10,
});


const schema: CollectionCreateSchema = {
  name: 'cards',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'mana_cost', type: 'string', optional: true },
    { name: 'cmc', type: 'float', optional: true },
    { name: 'color_identity', type: 'string[]', optional: true },
    { name: 'colors', type: 'string[]', optional: true },
    { name: 'type_line', type: 'string' },
    { name: 'oracle_text', type: 'string', optional: true },
    { name: 'rarity', type: 'string' },
    { name: 'set', type: 'string' }
  ],
  default_sorting_field: 'cmc'
};



async function createSchema() {
  try {
    const exists = await client.collections('cards').retrieve().catch(() => null);
    if (exists) {
      console.log('🔁 La colección "cards" ya existe. Eliminando para recrear...');
      await client.collections('cards').delete();
    }

    const created = await client.collections().create(schema);
    console.log('✅ Colección creada en Typesense:', created);
  } catch (err) {
    console.error('❌ Error al crear la colección:', err);
  }
}

createSchema();
