// src/test/testBulk.ts
import { fetch } from 'undici';
const QUERIES = ["Beholder's Enervation Ray", 'Barrow-Downs'];
const normalize = (s = '') => s.toLowerCase().replace(/[\u2019’']/g, "'").normalize('NFKC').trim();
async function main() {
    const url = `https://commander-scrapper.vercel.app/api/cards/bulk`; // 👈 CORREGIDO
    console.log('POST', url);
    console.log('Body', QUERIES);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ names: QUERIES }),
    });
    const text = await res.text();
    console.log('HTTP', res.status);
    if (!res.ok) {
        console.error('❌ Response body:', text);
        process.exit(1);
    }
    const docs = JSON.parse(text);
    console.log(`📦 Devueltos ${docs.length} documentos`);
    const pickHitsFor = (q) => {
        const qn = normalize(q);
        return docs.filter((d) => [d?.name, d?.face_name, d?.flavor_name].some(v => normalize(v ?? '') === qn));
    };
    const rows = QUERIES.map((q) => {
        const hits = pickHitsFor(q);
        const via = hits.map((h) => {
            const qn = normalize(q);
            if (normalize(h?.name ?? '') === qn)
                return 'name';
            if (normalize(h?.face_name ?? '') === qn)
                return 'face_name';
            if (normalize(h?.flavor_name ?? '') === qn)
                return 'flavor_name';
            return 'unknown';
        });
        return {
            query: q,
            resultCount: hits.length,
            via: Array.from(new Set(via)).join(','),
            ids: hits.map((h) => h.id).join(' | '),
            oracle_ids: hits.map((h) => h.oracle_id).join(' | '),
            names: hits.map((h) => h.name).join(' | '),
            flavors: hits.map((h) => h.flavor_name ?? '').filter(Boolean).join(' | '),
            released: hits.map((h) => h.released_at ?? '').join(' | '),
        };
    });
    console.table(rows);
    const unresolved = QUERIES.filter((q) => pickHitsFor(q).length === 0);
    if (unresolved.length > 0) {
        console.error('❌ Unresolved queries:', unresolved);
        process.exitCode = 2;
    }
    else {
        console.log('✅ Todas las queries resolvieron por name/face_name/flavor_name.');
    }
}
main().catch((e) => {
    console.error('💥 Error:', e);
    process.exit(1);
});
