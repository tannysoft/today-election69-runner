import 'dotenv/config';
import axios from 'axios';
import { authenticate } from '../pb.js';

// --- CONFIGURATION ---
const CONFIG = {
    SOURCE: {
        URL: process.env.SOURCE_REFERENDUM_URL,
        TOKEN: process.env.SOURCE_TOKEN,
    },
    POCKETBASE: {
        COLLECTION: 'referendum',
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

        // The API returns: { success: true, data: { electionId..., questions: [...] } }
        const data = response.data.data;
        const questions = data.questions || [];
        console.log(`📦 Found ${questions.length} questions to sync.`);
        return questions;
    } catch (error) {
        throw new Error(`Fetch Failed: ${error.message}`);
    }
}

/**
 * Sync a single item (question) to PocketBase
 */
async function syncItem(pb, item) {
    const questionText = item.questionText;

    // Extract agree/disagree votes
    const agreeOption = item.options.find(o => o.optionCode === 'agree');
    const disagreeOption = item.options.find(o => o.optionCode === 'disagree');

    // Fields to update/create
    const payload = {
        number: item.questionNumber,
        title: item.questionText,
        agreeTotalVotes: agreeOption ? agreeOption.totalVotes : 0,
        agreePercentage: agreeOption ? agreeOption.percentage : 0,
        agreeRank: agreeOption ? agreeOption.rank : 0,
        disagreeTotalVotes: disagreeOption ? disagreeOption.totalVotes : 0,
        disagreePercentage: disagreeOption ? disagreeOption.percentage : 0,
        disagreeRank: disagreeOption ? disagreeOption.rank : 0,
        goodVotes: item.goodVotes,
        totalVotes: item.totalVotes,
        invalidVotes: item.invalidVotes,
        noVotes: item.noVotes,
    };

    try {
        let existing = null;
        try {
            // Find by number
            existing = await pb.collection(CONFIG.POCKETBASE.COLLECTION).getFirstListItem(`number=${item.questionNumber}`);
        } catch (err) {
            if (err.status !== 404) throw err;
        }

        if (existing) {
            // Check if update is needed
            const isChanged =
                existing.agreeTotalVotes !== payload.agreeTotalVotes ||
                existing.agreePercentage !== payload.agreePercentage ||
                existing.agreeRank !== payload.agreeRank ||
                existing.disagreeTotalVotes !== payload.disagreeTotalVotes ||
                existing.disagreePercentage !== payload.disagreePercentage ||
                existing.disagreeRank !== payload.disagreeRank ||
                existing.totalVotes !== payload.totalVotes ||
                existing.title !== payload.title;

            if (isChanged) {
                await pb.collection(CONFIG.POCKETBASE.COLLECTION).update(existing.id, payload);
                console.log(`   [🔁 UPDATED] Q${item.questionNumber} (Total: ${existing.totalVotes} -> ${payload.totalVotes})`);
                return 'updated';
            } else {
                console.log(`   [⏭️ NO CHANGE] Q${item.questionNumber}`);
                return 'skipped';
            }
        } else {
            // Create new record
            await pb.collection(CONFIG.POCKETBASE.COLLECTION).create(payload);
            console.log(`   [✅ CREATED] Q${item.questionNumber}`);
            return 'created';
        }
    } catch (error) {
        console.error(`   [❌ FAIL] Q${item.questionNumber}: ${error.message} ${JSON.stringify(error.response || {})}`);
        return 'failed';
    }
}

async function main() {
    try {
        const pb = await authenticate();

        console.log('🚀 Starting Referendum Sync...');
        let stats = { created: 0, updated: 0, skipped: 0, failed: 0 };

        const items = await fetchData();

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
        console.log(`⏭️ Skipped: ${stats.skipped}`);
        console.log(`❌ Failed:  ${stats.failed}`);

    } catch (error) {
        console.error(`\n⛔ FATAL ERROR: ${error.message}`);
    }
}

main();
