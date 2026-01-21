import 'dotenv/config';
import axios from 'axios';
import { authenticate } from '../pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_NATIONAL_SUMMARY_REALTIME_URL,
        TOKEN: process.env.SOURCE_TOKEN,
    },
    POCKETBASE: {
        COLLECTION: 'parties',
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

        // Structure is { data: { parties: [...] }, ... }
        const items = response.data.data.parties || [];
        console.log(`📦 Found ${items.length} parties to sync.`);
        return items;
    } catch (error) {
        throw new Error(`Fetch Failed: ${error.message}`);
    }
}

/**
 * Sync a single item to PocketBase
 */
async function syncItem(pb, item) {
    const partyName = item.party?.name;

    // Fields to update/create
    const payload = {
        name: partyName, // Ensure name is included for creation
        totalVotes: item.totalVotes,
        constituencySeats: item.constituencySeats,
        partyListSeats: item.partyListSeats,
        totalSeats: item.totalSeats,
        percentage: item.percentage,
    };

    try {
        let existing = null;
        try {
            // Find party by name
            existing = await pb.collection(CONFIG.POCKETBASE.COLLECTION).getFirstListItem(`name="${partyName}"`);
        } catch (err) {
            if (err.status !== 404) throw err;
        }

        if (existing) {
            // Check if update is needed
            const isChanged =
                existing.totalVotes !== payload.totalVotes ||
                existing.constituencySeats !== payload.constituencySeats ||
                existing.partyListSeats !== payload.partyListSeats ||
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
            // Create new record
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

        console.log('🚀 Starting National Parties Sync...');
        let stats = { created: 0, updated: 0, skipped: 0, failed: 0 };

        const items = await fetchData();

        for (const item of items) {
            const result = await syncItem(pb, item);
            if (result === 'created') stats.created++;
            else if (result === 'updated') stats.updated++;
            else if (result === 'skipped') stats.skipped++; // 'skipped' means no change
            else stats.failed++;
        }

        console.log('-----------------------------------');
        console.log(`🏁 Sync Complete.`);
        console.log(`✅ Created: ${stats.created}`);
        console.log(`🔁 Updated: ${stats.updated}`);
        console.log(`⏭️ Skipped: ${stats.skipped}`);
        console.log(`❌ Failed:  ${stats.failed}`);

    } catch (error) {
        console.error(`\n⛔ FATAL ERROR: ${error.message}`);
        // process.exit(1); // Optional: keep process alive if running in interval later? For now just exit.
    }
}

main();
