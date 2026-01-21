import 'dotenv/config';
import axios from 'axios';
import { authenticate } from '../pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_PROVINCE_STATISTICS_URL,
        TOKEN: process.env.SOURCE_TOKEN,
    },
    POCKETBASE: {
        COLLECTION: 'provinces',
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

        const items = response.data.data || [];
        console.log(`📦 Found ${items.length} provinces to sync.`);
        return items;
    } catch (error) {
        throw new Error(`Fetch Failed: ${error.message}`);
    }
}

/**
 * Sync a single item to PocketBase
 */
async function syncItem(pb, item) {
    const provinceName = item.provinceName;

    // Fields to update
    const payload = {
        goodVotes: item.statistics?.goodVotes,
        totalVotes: item.statistics?.totalVotes,
        invalidVotes: item.statistics?.invalidVotes,
        noVotes: item.statistics?.noVotes,
        eligibleVoters: item.statistics?.eligibleVoters,
        voterTurnoutPercentage: item.statistics?.voterTurnoutPercentage,

        stationsReported: item.coverage?.stationsReported,
        totalStations: item.coverage?.totalStations,
        percentage: item.coverage?.percentage,
    };

    try {
        let existing = null;
        try {
            // Find province by name
            existing = await pb.collection(CONFIG.POCKETBASE.COLLECTION).getFirstListItem(`name="${provinceName}"`);
        } catch (err) {
            if (err.status !== 404) throw err;
        }

        if (existing) {
            // Check if update is needed
            const isChanged =
                existing.goodVotes !== payload.goodVotes ||
                existing.totalVotes !== payload.totalVotes ||
                existing.stationsReported !== payload.stationsReported ||
                existing.percentage !== payload.percentage;

            if (isChanged) {
                await pb.collection(CONFIG.POCKETBASE.COLLECTION).update(existing.id, payload);
                console.log(`   [🔁 UPDATED] ${provinceName} (Votes: ${existing.totalVotes} -> ${payload.totalVotes})`);
                return 'updated';
            } else {
                console.log(`   [⏭️ NO CHANGE] ${provinceName}`);
                return 'skipped';
            }
        } else {
            console.log(`   [⚠️ SKIPPED - NOT FOUND] ${provinceName}`);
            return 'skipped'; // Or 'failed' depending on how strict we want to be. Usually provinces should exist in masterdata.
        }
    } catch (error) {
        console.error(`   [❌ FAIL] ${provinceName}: ${error.message}`);
        return 'failed';
    }
}

async function main() {
    try {
        const pb = await authenticate();

        console.log('🚀 Starting Realtime Province Statistics Sync...');
        let stats = { updated: 0, skipped: 0, failed: 0 };

        const items = await fetchData();

        for (const item of items) {
            const result = await syncItem(pb, item);
            if (result === 'updated') stats.updated++;
            else if (result === 'skipped') stats.skipped++;
            else stats.failed++;
        }

        console.log('-----------------------------------');
        console.log(`🏁 Sync Complete.`);
        console.log(`🔁 Updated: ${stats.updated}`);
        console.log(`⏭️ Skipped: ${stats.skipped}`);
        console.log(`❌ Failed:  ${stats.failed}`);

    } catch (error) {
        console.error(`\n⛔ FATAL ERROR: ${error.message}`);
    }
}

main();
