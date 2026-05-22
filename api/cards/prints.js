export default async function handler(req, res) {
    try {
        const oracleId = req.query.oracle_id?.toString().trim();
        const name = req.query.name?.toString().trim();
        if (!oracleId && !name) {
            return res.status(400).json({ error: 'Missing "oracle_id" or "name" parameter' });
        }
        let scryfallUrl = 'https://api.scryfall.com/cards/search?q=';
        if (oracleId) {
            scryfallUrl += encodeURIComponent(`oracle_id:${oracleId} unique:prints`);
        }
        else if (name) {
            scryfallUrl += encodeURIComponent(`!"${name}" unique:prints`);
        }
        console.log(`📡 Fetching prints from Scryfall: ${scryfallUrl}`);
        const response = await fetch(scryfallUrl);
        if (!response.ok) {
            const text = await response.text();
            console.warn(`⚠️ Scryfall prints search failed:`, text);
            return res.status(response.status).send(text);
        }
        const data = (await response.json());
        const prints = data?.data || [];
        // Inyectar cabeceras de cache agresivas para que Vercel Edge lo cachee de forma global
        res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400');
        return res.status(200).json(prints);
    }
    catch (error) {
        console.error('💥 ERROR in /api/cards/prints:', error.message, error.stack);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
