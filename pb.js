import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

import PocketBase from 'pocketbase';

// --- CONFIGURATION ---
const CONFIG = {
    URL: process.env.PB_BASE_URL,
    EMAIL: process.env.PB_EMAIL,
    PASSWORD: process.env.PB_PASSWORD,
};

// Validate configuration
if (!CONFIG.EMAIL || !CONFIG.PASSWORD) {
    console.error("❌ Missing PocketBase credentials in .env file.");
    process.exit(1);
}

const pb = new PocketBase(CONFIG.URL);

/**
 * Authenticate using Admin or User credentials
 * @returns {Promise<PocketBase>} Authenticated PocketBase instance
 */
export async function authenticate() {
    // Return existing auth if valid
    if (pb.authStore.isValid) {
        return pb;
    }

    console.log('🔐 Authenticating with PocketBase...');
    try {
        try {
            await pb.collection('users').authWithPassword(CONFIG.EMAIL, CONFIG.PASSWORD);
            console.log('✅ User Authentication successful.');
        } catch (userAuthError) {
            // console.warn('User Auth Failed:', JSON.stringify(userAuthError, Object.getOwnPropertyNames(userAuthError), 2));
            console.log('ℹ️  User auth failed, trying Admin auth...');
            // Fallback to superuser/admin
            await pb.admins.authWithPassword(CONFIG.EMAIL, CONFIG.PASSWORD);
            console.log('✅ Admin Authentication successful.');
        }
        return pb;
    } catch (error) {
        console.error('Full Auth Error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
        throw new Error(`Authentication Failed: ${error.message}`);
    }
}
