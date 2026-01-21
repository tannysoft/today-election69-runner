import 'dotenv/config';
import axios from 'axios';
import { authenticate } from '../pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_NATIONAL_STATISTICS_URL,
        TOKEN: process.env.SOURCE_TOKEN,
    },
    POCKETBASE: {
        COLLECTION: 'national',
    },
};

/**
 * Fetch data from the source API
 */
async function fetchData() {
    console.log(`🌐 Fetching data from: ${CONFIG.SOURCE.URL}`);
    try {
        const response = await axios.get(CONFIG.SOURCE.URL, {
            headers: { Authorization: `Bearer ${CONFIG.SOURCE.TOKEN}` }
        });

        // Structure from curl output:
        // {
        //   "data": {
        //     "statistics": { "goodVotes": ... },
        //     "coverage": { "stationsReported": ... }
        //   }
        // }
        return response.data.data;
    } catch (error) {
        throw new Error(`Fetch Failed: ${error.message}`);
    }
}

/**
 * Sync data to PocketBase
 */
async function syncData(pb, data) {
    if (!data || !data.statistics || !data.coverage) {
        console.error('❌ Invalid data structure received');
        return 'failed';
    }

    const payload = {
        // From statistics
        goodVotes: data.statistics.goodVotes,
        totalVotes: data.statistics.totalVotes,
        invalidVotes: data.statistics.invalidVotes,
        noVotes: data.statistics.noVotes,
        eligibleVoters: data.statistics.eligibleVoters,
        voterTurnoutPercentage: data.statistics.voterTurnoutPercentage,

        // From coverage
        stationsReported: data.coverage.stationsReported,
        totalStations: data.coverage.totalStations,
        percentage: data.coverage.percentage,
    };

    try {
        // We assume there's only one "national" record. 
        // We will try to fetch the first one, if exists update, else create.
        let existing = null;
        try {
            const list = await pb.collection(CONFIG.POCKETBASE.COLLECTION).getList(1, 1);
            if (list.items.length > 0) {
                existing = list.items[0];
            }
        } catch (err) {
            // Collection might be empty or 404, proceed to create
            if (err.status !== 404) console.warn(`   [⚠️ Warning] Could not fetch existing record: ${err.message}`);
        }

        if (existing) {
            // Check if update is needed (compare a few key fields or just update)
            // For realtime stats, it changes often, so updating is likely fine.
            // But we can check to avoid spamming writes if unchanged.
            const isChanged =
                existing.goodVotes !== payload.goodVotes ||
                existing.stationsReported !== payload.stationsReported ||
                existing.percentage !== payload.percentage; // 'percentage' here is station coverage percentage

            if (isChanged) {
                await pb.collection(CONFIG.POCKETBASE.COLLECTION).update(existing.id, payload);
                console.log(`   [🔁 UPDATED] National Stats (Turnout: ${payload.voterTurnoutPercentage}%)`);
                return 'updated';
            } else {
                console.log(`   [⏭️ NO CHANGE] National Stats`);
                return 'skipped';
            }
        } else {
            await pb.collection(CONFIG.POCKETBASE.COLLECTION).create(payload);
            console.log(`   [✅ CREATED] National Stats`);
            return 'created';
        }
    } catch (error) {
        console.error(`   [❌ FAIL] Sync National Stats: ${error.message}`);
        return 'failed';
    }
}

async function main() {
    try {
        const pb = await authenticate();

        console.log('🚀 Starting National Statistics Sync...');

        const data = await fetchData();
        const result = await syncData(pb, data);

        console.log('-----------------------------------');
        console.log(`🏁 Sync Complete. Result: ${result}`);

    } catch (error) {
        console.error(`\n⛔ FATAL ERROR: ${error.message}`);
    }
}

main();
