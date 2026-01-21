import 'dotenv/config';
import axios from 'axios';
import { authenticate } from '../pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_CANDIDATES_STATIC_URL,
        TOKEN: process.env.SOURCE_TOKEN,
        PER_PAGE: 100 // Adjust if needed, API inspection showed no pagination key in 'data' root but likely supports it or returns all? 
        // Inspection showed keys: [ 'electionId', 'candidates', 'pagination' ] so it supports pagination.
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
        const items = data.candidates || [];
        const pagination = data.pagination || {};

        return { items, pagination };
    } catch (error) {
        throw new Error(`Fetch Page ${page} Failed: ${error.message}`);
    }
}

// --- CACHES ---
let partyCache = null;
let provinceCache = null;
let areaCache = null;

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

async function getProvinceId(pb, provinceName) {
    if (!provinceCache) {
        console.log('🔄 Loading provinces to cache...');
        provinceCache = new Map();
        try {
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

async function getAreaId(pb, provinceId, areaNumber) {
    if (!areaCache) {
        console.log('🔄 Loading areas to cache...');
        areaCache = new Map();
        try {
            const records = await pb.collection(CONFIG.POCKETBASE.COLLECTION_AREAS || 'areas').getFullList();
            for (const record of records) {
                const key = `${record.province}_${record.number}`;
                areaCache.set(key, record.id);
            }
            console.log(`✅ Cached ${areaCache.size} areas.`);
        } catch (e) {
            console.error('❌ Failed to cache areas:', e.message);
        }
    }
    return areaCache.get(`${provinceId}_${areaNumber}`);
}

/**
 * Sync a single item (Static Profile Data)
 */
async function syncItem(pb, item) {
    // Resolve Relations
    const partyName = item.party?.name;
    const partyId = await getPartyId(pb, partyName);

    const provinceName = item.province?.name;
    const provinceId = await getProvinceId(pb, provinceName);

    // Provide default area number if missing, or extract from electionArea object
    // API item: { electionArea: { areaNumber: 3, ... } }
    const areaNumber = item.electionArea?.areaNumber;
    let areaId = null;
    if (provinceId && areaNumber) {
        areaId = await getAreaId(pb, provinceId, areaNumber);
    }

    if (!partyId) console.warn(`   [⚠️ WARNING] Party not found: ${partyName}`);
    if (!provinceId) console.warn(`   [⚠️ WARNING] Province not found: ${provinceName}`);
    if (provinceId && areaNumber && !areaId) console.warn(`   [⚠️ WARNING] Area not found: ${provinceName} #${areaNumber}`);

    // Construct Payload
    // Include all static profile fields
    const payload = {
        name: item.name,
        // Profile fields
        title: item.title,
        firstName: item.firstName,
        lastName: item.lastName,
        photoUrl: item.photoUrl,
        active: item.active,

        // Basic fields (ensure consistency)
        number: item.number,
        provinceCode: item.province?.code,
        provinceName: item.province?.name,
        areaNumber: areaNumber,

        // Relations
        party: partyId,
        province: provinceId,
        area: areaId,
    };

    try {
        let existing = null;
        try {
            // Check by name
            existing = await pb.collection(CONFIG.POCKETBASE.COLLECTION).getFirstListItem(`name="${item.name}"`);
        } catch (err) {
            if (err.status !== 404) throw err;
        }

        if (existing) {
            // Check for changes in PROFILE data
            // We do NOT check votes/rank here (handled by sync-score.js)
            const isChanged =
                existing.title !== payload.title ||
                existing.firstName !== payload.firstName ||
                existing.lastName !== payload.lastName ||
                existing.photoUrl !== payload.photoUrl ||
                existing.active !== payload.active ||
                existing.party !== payload.party ||
                existing.province !== payload.province ||
                existing.area !== payload.area;

            if (isChanged) {
                await pb.collection(CONFIG.POCKETBASE.COLLECTION).update(existing.id, payload);
                console.log(`   [🔁 UPDATED] ${item.name} (Profile Updated)`);
                return 'updated';
            } else {
                console.log(`   [⏭️ NO CHANGE] ${item.name}`);
                return 'skipped';
            }
        } else {
            // Create new candidate
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

        console.log('🚀 Starting Candidate Profile Sync...');
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
