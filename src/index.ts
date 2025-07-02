import axios from 'axios';
import fs from 'fs';
import path from 'path';

const SOURCE_URL = 'https://raw.githubusercontent.com/taw/magic-preconstructed-decks-data/master/decks_v2.json';
const OUTPUT_PATH = path.resolve(__dirname, '../data/commander_precons.json');

function groupCardsByName(cards: { name: string; count: number }[]) {
  const grouped: Record<string, number> = {};

  for (const card of cards) {
    if (grouped[card.name]) {
      grouped[card.name] += card.count;
    } else {
      grouped[card.name] = card.count;
    }
  }

  return Object.entries(grouped).map(([name, count]) => ({ name, count }));
}

async function main() {
  try {
    console.log('Descargando archivo JSON...');
    const res = await axios.get(SOURCE_URL);
    const allDecks = res.data;

    console.log('Filtrando mazos Commander...');
    const commanderDecks = Object.values(allDecks).filter((deck: any) => deck.commander?.length > 0);

    const simplified = commanderDecks.map((deck: any) => {
      const groupedCards = groupCardsByName(deck.cards);

      return {
        name: deck.name,
        commander: deck.commander[0]?.name ?? 'Desconocido',
        cards: groupedCards
      };
    });

    console.log(`Guardando ${simplified.length} mazos filtrados...`);
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(simplified, null, 2), 'utf-8');

    console.log('✅ Archivo guardado en:', OUTPUT_PATH);
  } catch (error) {
    console.error('Error al ejecutar el scraper:', error);
  }
}

main();
