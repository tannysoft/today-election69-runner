import 'dotenv/config';
import axios from 'axios';
import { authenticate } from './pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_PARTYLIST_RESULTS_URL,
        TOKEN: process.env.SOURCE_TOKEN,
    },
    POCKETBASE: {
        COLLECTION: 'partylistResults', // User specified 'partylistResults'
    },
};

/**
 * Fetch data from the source API
 * Note: This API seems to return all results in one go, not paginated pages of items.
 */
async function fetchData() {
    console.log(`🌐 Fetching data from: ${CONFIG.SOURCE.URL}`);
    try {
        const response = await axios.get(CONFIG.SOURCE.URL, {
            headers: { Authorization: `Bearer ${CONFIG.SOURCE.TOKEN}` }
        });

        const data = response.data.data;
        const items = data.parties || [];

        return items;
    } catch (error) {
        throw new Error(`Fetch Failed: ${error.message}`);
    }
}

// --- CACHES ---
let partyCache = null;

async function getPartyId(pb, partyName) {
    if (!partyCache) {
        console.log('🔄 Loading parties to cache...');
        partyCache = new Map();
        try {
            const records = await pb.collection(process.env.PB_COLLECTION_PARTIES || 'parties').getFullList();
            for (const record of records) {
                partyCache.set(record.name, record.id);
            }
            console.log(`✅ Cached ${partyCache.size} parties.`);
        } catch (e) {
            console.error('❌ Failed to cache parties:', e.message);
        }
    }
    return partyCache.get(partyName);
}

/**
 * Sync a single item
 */
async function syncItem(pb, item) {
    // Resolve Relations
    const partyName = item.party?.name;
    const partyId = await getPartyId(pb, partyName);

    if (!partyId) console.warn(`   [⚠️ WARNING] Party not found: ${partyName}`);

    // Construct Payload
    const payload = {
        totalVotes: item.totalVotes,
        automaticSeats: item.automaticSeats,
        remainder: item.remainder,
        remainderSeats: item.remainderSeats,
        totalSeats: item.totalSeats,
        percentage: item.percentage,
        party: partyId,
    };

    try {
        let existing = null;
        try {
            // Check by party ID (assuming one result record per party)
            if (partyId) {
                existing = await pb.collection(CONFIG.POCKETBASE.COLLECTION).getFirstListItem(`party="${partyId}"`);
            }
        } catch (err) {
            if (err.status !== 404) throw err;
        }

        if (existing) {
            // Check for changes
            const isChanged =
                existing.totalVotes !== payload.totalVotes ||
                existing.automaticSeats !== payload.automaticSeats ||
                existing.remainder !== payload.remainder ||
                existing.remainderSeats !== payload.remainderSeats ||
                existing.totalSeats !== payload.totalSeats ||
                existing.percentage !== payload.percentage;

            if (isChanged) {
                await pb.collection(CONFIG.POCKETBASE.COLLECTION).update(existing.id, payload);
                console.log(`   [🔁 UPDATED] ${partyName} (Votes: ${existing.totalVotes} -> ${payload.totalVotes})`);
                return 'updated';
            } else {
                console.log(`   [⏭️ NO CHANGE] ${partyName}`);
                return 'skipped';
            }
        } else {
            // Create new
            await pb.collection(CONFIG.POCKETBASE.COLLECTION).create(payload);
            console.log(`   [✅ CREATED] ${partyName}`);
            return 'created';
        }
    } catch (error) {
        console.error(`   [❌ FAIL] ${partyName}: ${error.message}`);
        return 'failed';
    }
}

async function main() {
    try {
        const pb = await authenticate();

        console.log('🚀 Starting Party List Results Sync...');
        let stats = { created: 0, updated: 0, skipped: 0, failed: 0 };

        const items = await fetchData();
        console.log(`📦 Processing ${items.length} items...`);

        for (const item of items) {
            const result = await syncItem(pb, item);
            if (result === 'created') stats.created++;
            else if (result === 'updated') stats.updated++;
            else if (result === 'skipped') stats.skipped++;
            else stats.failed++;
        }

        console.log('-----------------------------------');
        console.log(`🏁 Sync Complete.`);
        console.log(`✅ Created: ${stats.created}`);
        console.log(`🔁 Updated: ${stats.updated}`);
        console.log(`⏭️ No Change: ${stats.skipped}`);
        console.log(`❌ Failed:  ${stats.failed}`);

    } catch (error) {
        console.error(`\n⛔ FATAL ERROR: ${error.message}`);
        process.exit(1);
    }
}

main();
