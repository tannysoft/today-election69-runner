import 'dotenv/config';
import axios from 'axios';
import { authenticate } from './pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_AREAS_URL,
        TOKEN: process.env.SOURCE_TOKEN,
        PER_PAGE: 100
    },
    POCKETBASE: {
        COLLECTION: 'areas',
    },
};

/**
 * Fetch a page of data from the source API
 */
async function fetchPage(page) {
    console.log(`🌐 Fetching page ${page} from: ${CONFIG.SOURCE.URL}`);
    try {
        const response = await axios.get(CONFIG.SOURCE.URL, {
            headers: { Authorization: `Bearer ${CONFIG.SOURCE.TOKEN}` },
            params: {
                page: page,
                per_page: CONFIG.SOURCE.PER_PAGE
            }
        });

        const data = response.data.data;
        const items = data.electionAreas || [];
        const pagination = data.pagination || {};

        return { items, pagination };
    } catch (error) {
        throw new Error(`Fetch Page ${page} Failed: ${error.message}`);
    }
}

// Cache for provinces: name -> id
let provinceCache = null;

async function getProvinceId(pb, provinceName) {
    if (!provinceCache) {
        console.log('🔄 Loading provinces to cache...');
        provinceCache = new Map();
        try {
            // Fetch all provinces (limit 1000)
            const records = await pb.collection(CONFIG.POCKETBASE.COLLECTION_PROVINCES || 'provinces').getFullList();
            for (const record of records) {
                provinceCache.set(record.name, record.id);
            }
            console.log(`✅ Cached ${provinceCache.size} provinces.`);
        } catch (e) {
            console.error('❌ Failed to cache provinces:', e.message);
        }
    }
    return provinceCache.get(provinceName);
}

/**
 * Sync a single item to PocketBase with Smart Update
 */
async function syncItem(pb, item) {
    // Resolve province
    const provinceName = item.province?.name;
    const provinceId = await getProvinceId(pb, provinceName);

    if (!provinceId) {
        console.warn(`   [⚠️ WARNING] Province not found: ${provinceName} for area ${item.name}`);
    }

    const payload = {
        name: item.name,
        // electionId: item.electionId, // Optional if needed
        number: item.number,
        eligibleVoters: item.eligibleVoters,
        province: provinceId,
    };

    try {
        // Check for existing record by name
        let existing = null;
        try {
            existing = await pb.collection(CONFIG.POCKETBASE.COLLECTION).getFirstListItem(`name="${item.name}"`);
        } catch (err) {
            if (err.status !== 404) throw err;
        }

        if (existing) {
            // Check if update is needed
            const isChanged =
                existing.eligibleVoters !== payload.eligibleVoters ||
                existing.province !== payload.province ||
                existing.number !== payload.number;

            if (isChanged) {
                await pb.collection(CONFIG.POCKETBASE.COLLECTION).update(existing.id, payload);
                console.log(`   [🔁 UPDATED] ${item.name}`);
                return 'updated';
            } else {
                console.log(`   [⏭️ NO CHANGE] ${item.name}`);
                return 'skipped';
            }
        } else {
            await pb.collection(CONFIG.POCKETBASE.COLLECTION).create(payload);
            console.log(`   [✅ CREATED] ${item.name}`);
            return 'created';
        }
    } catch (error) {
        console.error(`   [❌ FAIL] ${item.name}: ${error.message}`);
        console.error(JSON.stringify(error.data, null, 2));
        return 'failed';
    }
}

async function main() {
    try {
        const pb = await authenticate();

        console.log('🚀 Starting sync...');
        let stats = { created: 0, updated: 0, skipped: 0, failed: 0 };

        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const { items, pagination } = await fetchPage(page);

            if (items.length === 0) {
                hasMore = false;
                break;
            }

            console.log(`📦 Processing ${items.length} items from page ${page}/${pagination.totalPages}...`);

            for (const item of items) {
                const result = await syncItem(pb, item);
                if (result === 'created') stats.created++;
                else if (result === 'updated') stats.updated++;
                else if (result === 'skipped') stats.skipped++;
                else stats.failed++;
            }

            // Check if we reached the last page
            if (page >= pagination.totalPages) {
                hasMore = false;
            } else {
                page++;
            }
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
