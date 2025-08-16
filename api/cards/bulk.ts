import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'typesense';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const names: string[] = req.body?.names;
  if (!Array.isArray(names) || names.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing "names" in request body"' });
  }

  const client = new Client({
    nodes: [{ host: 'typesense-commanderscrapper.fly.dev', port: 443, protocol: 'https' }],
    apiKey: 'typsensemasterkeyMariArri30123456789',
  });

  const results: any[] = [];
  // ⬇️ ahora deduplicamos por (oracle_id + flavor_name_normalizado)
  const seen = new Set<string>();
  const chunkSize = 20;

  const normalize = (str: string) =>
    (str ?? '').toLowerCase().replace(/[\u2019’']/g, "'").normalize('NFKC').trim();

  const seenKey = (doc: any) => `${doc.oracle_id}|${normalize(doc.flavor_name ?? '')}`;

  for (let i = 0; i < names.length; i += chunkSize) {
    const batch = names.slice(i, i + chunkSize);
    console.log('🔍 Searching for:', batch);

    const searches = batch.map((name) => ({
      q: name,
      query_by: 'name',
      per_page: 5,
      num_typos: 0,
      prefix: 'false',
      exhaustive_search: true,
      // sort_by: 'released_at:desc', // opcional: resultado determinista
      collection: 'cards',
    }));

    const batchResults = await client.multiSearch.perform({ searches }) as {
      results: Array<{ hits?: any[]; [key: string]: any }>;
    };

    for (let j = 0; j < batchResults.results.length; j++) {
      const hits = batchResults.results[j]?.hits || [];
      const originalName = batch[j];

      // 1) name
      const exact = hits.find(
        (hit: any) => normalize(hit.document.name) === normalize(originalName)
      );

      if (exact) {
        const key = seenKey(exact.document);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(exact.document);
        }
        continue;
      }

      // 2) face_name (fallback)
      try {
        const fallback = await client.collections('cards').documents().search({
          q: originalName,
          query_by: 'face_name',
          per_page: 3,
          num_typos: 0,
          prefix: 'false',
          exhaustive_search: true,
          // sort_by: 'released_at:desc',
        });

        const faceHit = fallback.hits?.find(
          (hit: any) => normalize(hit.document.face_name ?? '') === normalize(originalName)
        );

        if (faceHit) {
          const key = seenKey(faceHit.document);
          if (!seen.has(key)) {
            seen.add(key);
            results.push(faceHit.document);
            console.warn(`⚠️ Carta encontrada por face_name: "${originalName}"`);
          }
          continue;
        }
      } catch (e) {
        console.error(`💥 Error en fallback face_name de "${originalName}":`, e);
      }

      // 3) flavor_name (fallback final SOLO por flavor_name)
      try {
        const flavorRes = await client.collections('cards').documents().search({
          q: originalName,
          query_by: 'flavor_name',
          per_page: 3,
          num_typos: 0,
          prefix: 'false',
          exhaustive_search: true,
          // sort_by: 'released_at:desc',
        });

        const flavorHit = flavorRes.hits?.find(
          (hit: any) => normalize(hit.document.flavor_name ?? '') === normalize(originalName)
        );

        if (flavorHit) {
          const key = seenKey(flavorHit.document);
          if (!seen.has(key)) {
            seen.add(key);
            results.push(flavorHit.document);
            console.warn(`⚠️ Carta encontrada por flavor_name: "${originalName}"`);
          }
        } else {
          console.error(`❌ Carta no encontrada en DB (bulk): "${originalName}"`);
        }
      } catch (e) {
        console.error(`💥 Error en fallback flavor_name de "${originalName}":`, e);
      }
      
      // 4) face_flavor_names (fallback final)
      try {
        const flavorFaceRes = await client.collections('cards').documents().search({
          q: originalName,
          query_by: 'face_flavor_names',
          per_page: 3,
          num_typos: 0,
          prefix: 'false',
          exhaustive_search: true,
        });

        const ffHit = flavorFaceRes.hits?.find((hit: any) => {
          const arr = hit.document.face_flavor_names ?? [];
          return Array.isArray(arr) && arr.some((s: string) => normalize(s) === normalize(originalName));
        });

        if (ffHit) {
          const key = seenKey(ffHit.document);
          if (!seen.has(key)) {
            seen.add(key);
            results.push(ffHit.document);
            console.warn(`⚠️ Carta encontrada por face_flavor_names: "${originalName}"`);
          }
        } else {
          console.error(`❌ Carta no encontrada en DB (bulk): "${originalName}"`);
        }
      } catch (e) {
        console.error(`💥 Error en fallback face_flavor_names de "${originalName}":`, e);
      }

    }
  }

  return res.status(200).json(results);
}
