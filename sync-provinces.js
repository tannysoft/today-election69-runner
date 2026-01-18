import 'dotenv/config';
import axios from 'axios';
import { authenticate } from './pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_URL,
        TOKEN: process.env.SOURCE_TOKEN,
    },
    POCKETBASE: {
        COLLECTION: process.env.PB_COLLECTION || 'provinces',
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
        const items = response.data.data.provinces || [];
        console.log(`📦 Found ${items.length} items to sync.`);
        return items;
    } catch (error) {
        throw new Error(`Fetch Failed: ${error.message}`);
    }
}

/**
 * Sync a single item to PocketBase
 * @param {PocketBase} pb - Authenticated PocketBase instance
 * @param {Object} item - Province object
 */
async function syncItem(pb, item) {
    const payload = {
        name: item.name,
        code: item.code,
        region: item.region,
    };

    try {
        // Check for duplicate by name
        try {
            await pb.collection(CONFIG.POCKETBASE.COLLECTION).getFirstListItem(`name="${item.name}"`);
            console.log(`   [⏭️ SKIP] ${item.name} (Already exists)`);
            return 'skipped';
        } catch (err) {
            // If 404, it means not found, so we proceed. Other errors should be thrown.
            if (err.status !== 404) throw err;
        }

        await pb.collection(CONFIG.POCKETBASE.COLLECTION).create(payload);
        console.log(`   [✅ CREATED] ${item.name}`);
        return 'created';
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
        let stats = { created: 0, skipped: 0, failed: 0 };

        for (const item of items) {
            const result = await syncItem(pb, item);
            if (result === 'created') stats.created++;
            else if (result === 'skipped') stats.skipped++;
            else stats.failed++;
        }

        console.log('-----------------------------------');
        console.log(`🏁 Sync Complete.`);
        console.log(`✅ Created: ${stats.created}`);
        console.log(`⏭️ Skipped: ${stats.skipped}`);
        console.log(`❌ Failed:  ${stats.failed}`);

    } catch (error) {
        console.error(`\n⛔ FATAL ERROR: ${error.message}`);
        process.exit(1);
    }
}

main();
