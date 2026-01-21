import 'dotenv/config';
import axios from 'axios';
import { authenticate } from '../pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_SCORE_URL,
        TOKEN: process.env.SOURCE_TOKEN,
        PER_PAGE: 100
    },
    POCKETBASE: {
        COLLECTION: 'candidates',
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
        // Adjust based on inspection: data.candidates stores the list
        const items = data.candidates || [];
        const pagination = data.pagination || {};

        return { items, pagination };
    } catch (error) {
        throw new Error(`Fetch Page ${page} Failed: ${error.message}`);
    }
}

// Cache for parties: name -> id
let partyCache = null;

async function getPartyId(pb, partyName) {
    if (!partyCache) {
        console.log('🔄 Loading parties to cache...');
        partyCache = new Map();
        try {
            // Fetch all parties (assuming < 1000 for now, or use pagination if many)
            const records = await pb.collection(CONFIG.POCKETBASE.COLLECTION_PARTIES || 'parties').getFullList();
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
                // Determine which field to use. Usually 'name' is safest if API is consistent.
                provinceCache.set(record.name, record.id);
            }
            console.log(`✅ Cached ${provinceCache.size} provinces.`);
        } catch (e) {
            console.error('❌ Failed to cache provinces:', e.message);
        }
    }
    return provinceCache.get(provinceName);
}

// Cache for areas: `${provinceId}_${areaNumber}` -> areaId
let areaCache = null;

async function getAreaId(pb, provinceId, areaNumber) {
    if (!areaCache) {
        console.log('🔄 Loading areas to cache...');
        areaCache = new Map();
        try {
            // Fetch all areas (assuming < 1000 or use pagination if needed)
            // Ideally use getFullList to be safe
            const records = await pb.collection(CONFIG.POCKETBASE.COLLECTION_AREAS || 'areas').getFullList();
            for (const record of records) {
                // Key: ProvinceID + "_" + AreaNumber
                // Ensure province is the ID relation
                const key = `${record.province}_${record.number}`;
                areaCache.set(key, record.id);
            }
            console.log(`✅ Cached ${areaCache.size} areas.`);
        } catch (e) {
            console.error('❌ Failed to cache areas:', e.message);
        }
    }
    const searchKey = `${provinceId}_${areaNumber}`;
    return areaCache.get(searchKey);
}

/**
 * Sync a single item to PocketBase with Smart Update
 */
async function syncItem(pb, item) {
    const payload = {
        name: item.name,
        totalVotes: item.totalVotes,
        rank: item.rank,
        percentage: item.percentage,
    };

    try {
        // Check for existing record by Name
        let existing = null;
        try {
            existing = await pb.collection(CONFIG.POCKETBASE.COLLECTION).getFirstListItem(`name="${item.name}"`);
        } catch (err) {
            if (err.status !== 404) throw err;
        }

        if (existing) {
            // Check if update is needed
            // Only checking score fields
            const isChanged =
                existing.totalVotes !== payload.totalVotes ||
                existing.rank !== payload.rank ||
                existing.percentage !== payload.percentage;

            if (isChanged) {
                // Update ONLY score fields
                await pb.collection(CONFIG.POCKETBASE.COLLECTION).update(existing.id, payload);
                console.log(`   [🔁 UPDATED] ${item.name} (Votes: ${existing.totalVotes} -> ${payload.totalVotes})`);
                return 'updated';
            } else {
                console.log(`   [⏭️ NO CHANGE] ${item.name}`);
                return 'skipped';
            }
        } else {
            // UPDATE ONLY: Do not create
            console.log(`   [⚠️ SKIPPED - NOT FOUND] ${item.name}`);
            return 'skipped';
        }
    } catch (error) {
        console.error(`   [❌ FAIL] ${item.name}: ${error.message}`);
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
                else if (result === 'skipped') stats.skipped++; // 'skipped' now means 'no change' or 'not found'
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
        console.log(`✅ Created: ${stats.created} (Should be 0)`);
        console.log(`🔁 Updated: ${stats.updated}`);
        console.log(`⏭️ Skipped: ${stats.skipped}`);
        console.log(`❌ Failed:  ${stats.failed}`);

    } catch (error) {
        console.error(`\n⛔ FATAL ERROR: ${error.message}`);
        process.exit(1);
    }
}

main();
