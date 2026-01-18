import 'dotenv/config';
import axios from 'axios';
import { authenticate } from './pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_PARTIES_URL || 'https://media.election.in.th/api/media/parties',
        TOKEN: process.env.SOURCE_TOKEN,
    },
    POCKETBASE: {
        COLLECTION: 'parties',
    },
};

/**
 * Fetch data from the source API
 */
async function fetchSourceData() {
    console.log(`🌐 Fetching data from: ${CONFIG.SOURCE.URL}`);
    try {
        const response = await axios.get(CONFIG.SOURCE.URL, {
            headers: { Authorization: `Bearer ${CONFIG.SOURCE.TOKEN}` },
            params: { limit: 1000 }
        });
        const items = response.data.data.parties || [];
        console.log(`📦 Found ${items.length} items to sync.`);
        return items;
    } catch (error) {
        throw new Error(`Fetch Failed: ${error.message}`);
    }
}

/**
 * Sync a single item to PocketBase
 * @param {PocketBase} pb - Authenticated PocketBase instance
 * @param {Object} item - Party object
 */
async function syncItem(pb, item) {
    const payload = {
        name: item.name,
        code: item.code,
        abbreviation: item.abbreviation,
        color: item.color,
        logoUrl: item.logoUrl,
        totalCandidates: item.totalCandidates,
    };

    try {
        // Check for duplicate by name
        let existingId = null;
        try {
            const existing = await pb.collection(CONFIG.POCKETBASE.COLLECTION).getFirstListItem(`name="${item.name}"`);
            existingId = existing.id;
        } catch (err) {
            if (err.status !== 404) throw err;
        }

        if (existingId) {
            await pb.collection(CONFIG.POCKETBASE.COLLECTION).update(existingId, payload);
            console.log(`   [🔁 UPDATED] ${item.name}`);
            return 'updated';
        } else {
            await pb.collection(CONFIG.POCKETBASE.COLLECTION).create(payload);
            console.log(`   [✅ CREATED] ${item.name}`);
            return 'created';
        }
    } catch (error) {
        console.error(`   [❌ FAIL] ${item.name}: ${error.message}`);
        return 'failed';
    }
}

/**
 * Main execution function
 */
async function main() {
    try {
        const pb = await authenticate();
        const items = await fetchSourceData();

        console.log('🚀 Starting sync...');
        let stats = { created: 0, updated: 0, failed: 0 };

        for (const item of items) {
            const result = await syncItem(pb, item);
            if (result === 'created') stats.created++;
            else if (result === 'updated') stats.updated++;
            else stats.failed++;
        }

        console.log('-----------------------------------');
        console.log(`🏁 Sync Complete.`);
        console.log(`✅ Created: ${stats.created}`);
        console.log(`🔁 Updated: ${stats.updated}`);
        console.log(`❌ Failed:  ${stats.failed}`);

    } catch (error) {
        console.error(`\n⛔ FATAL ERROR: ${error.message}`);
        process.exit(1);
    }
}

main();
