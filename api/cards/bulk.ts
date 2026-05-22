import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'typesense';

interface ParsedQuery {
  original: string;
  cleanName: string;
  set?: string;
  cn?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const rawNames: string[] = req.body?.names;
  if (!Array.isArray(rawNames) || rawNames.length === 0) {
    return res.status(400).json({ error: 'Invalid or missing "names" in request body' });
  }

  const client = new Client({
    nodes: [{ host: 'typesense-commanderscrapper.fly.dev', port: 443, protocol: 'https' }],
    apiKey: 'typsensemasterkeyMariArri30123456789',
  });

  const normalize = (str: string) =>
    (str ?? '').toLowerCase().replace(/[\u2019’']/g, "'").normalize('NFKC').trim();

  // Parsear las consultas entrantes
  const parsedQueries: ParsedQuery[] = rawNames.map((name) => {
    if (name.includes('|')) {
      const parts = name.split('|');
      return {
        original: name,
        cleanName: parts[0].trim(),
        set: parts[1]?.trim()?.toLowerCase(),
        cn: parts[2]?.trim(),
      };
    }
    return {
      original: name,
      cleanName: name.trim(),
    };
  });

  const results: any[] = [];
  const seen = new Set<string>();
  const seenKey = (doc: any) => doc.id;

  // Aumentar el tamaño del bloque a 100 para procesamiento paralelo masivo
  const chunkSize = 100;
  const unresolvedQueries: ParsedQuery[] = [];

  for (let i = 0; i < parsedQueries.length; i += chunkSize) {
    const batch = parsedQueries.slice(i, i + chunkSize);

    // Preparar peticiones de búsqueda paralela en Typesense
    const searches = batch.map((item) => ({
      q: item.cleanName,
      query_by: 'name,face_name,flavor_name', // Buscar en todos los campos relevantes de forma simultánea
      per_page: 10,
      num_typos: 0,
      prefix: 'false',
      exhaustive_search: true,
      collection: 'cards',
    }));

    try {
      const batchResults = (await client.multiSearch.perform({ searches })) as {
        results: Array<{ hits?: any[]; [key: string]: any }>;
      };

      for (let j = 0; j < batch.length; j++) {
        const query = batch[j];
        const hits = batchResults.results[j]?.hits || [];
        let resolvedDoc: any = null;

        // 1) Si se solicita un set y collector number específico, buscar coincidencia exacta
        if (query.set && query.cn) {
          const exactPrint = hits.find(
            (hit: any) =>
              normalize(hit.document.name) === normalize(query.cleanName) &&
              normalize(hit.document.set) === query.set &&
              hit.document.collector_number === query.cn
          );
          if (exactPrint) {
            resolvedDoc = exactPrint.document;
          }
        }

        // 2) Si no se solicitó una versión específica, buscar por coincidencia de nombre general en Typesense
        if (!resolvedDoc && !(query.set && query.cn)) {
          // Coincidencia exacta de nombre
          const nameMatch = hits.find(
            (hit: any) => normalize(hit.document.name) === normalize(query.cleanName)
          );
          if (nameMatch) {
            resolvedDoc = nameMatch.document;
          } else {
            // Coincidencia de face_name
            const faceMatch = hits.find(
              (hit: any) => normalize(hit.document.face_name ?? '') === normalize(query.cleanName)
            );
            if (faceMatch) {
              resolvedDoc = faceMatch.document;
            } else {
              // Coincidencia de flavor_name
              const flavorMatch = hits.find(
                (hit: any) =>
                  normalize(hit.document.flavor_name ?? '') === normalize(query.cleanName)
              );
              if (flavorMatch) {
                resolvedDoc = flavorMatch.document;
              } else {
                // Coincidencia de face_flavor_names
                const ffMatch = hits.find((hit: any) => {
                  const arr = hit.document.face_flavor_names ?? [];
                  return (
                    Array.isArray(arr) &&
                    arr.some((s: string) => normalize(s) === normalize(query.cleanName))
                  );
                });
                if (ffMatch) {
                  resolvedDoc = ffMatch.document;
                }
              }
            }
          }
        }

        if (resolvedDoc) {
          const key = seenKey(resolvedDoc);
          if (!seen.has(key)) {
            seen.add(key);
            results.push(resolvedDoc);
          }
        } else {
          // Si no se resolvió con Typesense local, guardar para fallback grupal de Scryfall
          unresolvedQueries.push(query);
        }
      }
    } catch (err: any) {
      console.error('💥 Error performing Typesense multiSearch batch:', err.message);
      // En caso de error general en el lote de Typesense, marcar todo el lote como unresolved
      unresolvedQueries.push(...batch);
    }
  }

  // Fallback grupal de Scryfall de alto rendimiento
  if (unresolvedQueries.length > 0) {
    console.log(`🔎 Resolviendo ${unresolvedQueries.length} cartas en Scryfall desde el backend...`);
    const scryfallChunkSize = 75;

    for (let i = 0; i < unresolvedQueries.length; i += scryfallChunkSize) {
      const sBatch = unresolvedQueries.slice(i, i + scryfallChunkSize);
      const identifiers = sBatch.map((q) => {
        if (q.set && q.cn) {
          return { set: q.set, collector_number: q.cn };
        }
        return { name: q.cleanName };
      });

      try {
        const scryfallRes = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers }),
        });

        if (scryfallRes.ok) {
          const scryfallData = (await scryfallRes.json()) as { data: any[] };
          if (scryfallData?.data) {
            for (const doc of scryfallData.data) {
              if (doc && doc.id && doc.object !== 'error') {
                const key = seenKey(doc);
                if (!seen.has(key)) {
                  seen.add(key);
                  results.push(doc);
                }
              }
            }
          }
        } else {
          const errText = await scryfallRes.text();
          console.error(`❌ Scryfall fallback failed for batch:`, errText);
        }
      } catch (err: any) {
        console.error(`❌ Error in Scryfall fallback batch fetch:`, err.message);
      }

      // Pequeño retardo si hay más de un lote de Scryfall para respetar los límites de tasa de Scryfall
      if (i + scryfallChunkSize < unresolvedQueries.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  return res.status(200).json(results);
}
