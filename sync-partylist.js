import 'dotenv/config';
import axios from 'axios';
import { authenticate } from './pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_PARTYLIST_URL,
        TOKEN: process.env.SOURCE_TOKEN,
        PER_PAGE: 100
    },
    POCKETBASE: {
        COLLECTION: 'partylist', // User specified 'partylist'
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
        const items = data.partyLists || [];
        const pagination = data.pagination || {};

        return { items, pagination };
    } catch (error) {
        throw new Error(`Fetch Page ${page} Failed: ${error.message}`);
    }
}

// --- CACHES ---
let partyCache = null;

async function getPartyId(pb, partyName) {
    if (!partyCache) {
        console.log('🔄 Loading parties to cache...');
        partyCache = new Map();
        try {
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
        name: item.name,
        number: item.number,
        title: item.title,
        firstName: item.firstName,
        lastName: item.lastName,
        pmCandidateRank: item.pmCandidateRank, // Might be null
        active: item.active,
        party: partyId,
    };

    try {
        let existing = null;
        try {
            // Check by name (or name + party if names aren't unique globally, but usually full name is unique enough)
            existing = await pb.collection(CONFIG.POCKETBASE.COLLECTION).getFirstListItem(`name="${item.name}"`);
        } catch (err) {
            if (err.status !== 404) throw err;
        }

        if (existing) {
            // Check for changes
            const isChanged =
                existing.number !== payload.number ||
                existing.title !== payload.title ||
                existing.firstName !== payload.firstName ||
                existing.lastName !== payload.lastName ||
                existing.pmCandidateRank !== payload.pmCandidateRank ||
                existing.active !== payload.active ||
                existing.party !== payload.party;

            if (isChanged) {
                await pb.collection(CONFIG.POCKETBASE.COLLECTION).update(existing.id, payload);
                console.log(`   [🔁 UPDATED] ${item.name}`);
                return 'updated';
            } else {
                console.log(`   [⏭️ NO CHANGE] ${item.name}`);
                return 'skipped';
            }
        } else {
            // Create new
            await pb.collection(CONFIG.POCKETBASE.COLLECTION).create(payload);
            console.log(`   [✅ CREATED] ${item.name}`);
            return 'created';
        }
    } catch (error) {
        console.error(`   [❌ FAIL] ${item.name}: ${error.message}`);
        // console.error(JSON.stringify(error.data, null, 2));
        return 'failed';
    }
}

async function main() {
    try {
        const pb = await authenticate();

        console.log('🚀 Starting Party List Sync...');
        let stats = { created: 0, updated: 0, skipped: 0, failed: 0 };

        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const { items, pagination } = await fetchPage(page);

            if (items.length === 0) {
                hasMore = false;
                break;
            }

            console.log(`📦 Processing ${items.length} items from page ${page}/${pagination.totalPages || '?'}...`);

            for (const item of items) {
                const result = await syncItem(pb, item);
                if (result === 'created') stats.created++;
                else if (result === 'updated') stats.updated++;
                else if (result === 'skipped') stats.skipped++;
                else stats.failed++;
            }

            if (pagination.totalPages && page >= pagination.totalPages) {
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
