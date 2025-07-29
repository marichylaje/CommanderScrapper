import { request } from 'undici';

const API_KEY = process.env.TYPESENSE_API_KEY;
const COLLECTION = 'cards';
const HOST = 'https://typesense-commanderscrapper.fly.dev';

if (!API_KEY) {
  console.error('❌ Falta la variable de entorno TYPESENSE_API_KEY');
  process.exit(1);
}

async function deleteCollection() {
  try {
    const res = await request(`${HOST}/collections/${COLLECTION}`, {
      method: 'DELETE',
      headers: {
        'X-TYPESENSE-API-KEY': API_KEY,
      },
    });

    const body = await res.body.json();

    if (res.statusCode === 200) {
      console.log(`🗑️ Colección "${COLLECTION}" eliminada con éxito.`);
    } else {
      console.warn(`⚠️ Respuesta inesperada: ${res.statusCode}`);
      console.warn(body);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error al eliminar la colección:', error.message);
    } else {
      console.error('❌ Error desconocido:', error);
    }
    process.exit(1);
  }
}

deleteCollection();
