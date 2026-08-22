/**
 * One-time migration helper.
 *
 * Run this on the server (where you have access to the real DB):
 *
 *   node utils/create_apk_signing_keys_table.js
 *
 * Stores one auto-generated release keystore per (github_user_id,
 * project_name) so repeated APK/AAB builds of the same project are always
 * signed with the same key — required for Play Store update compatibility.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function run() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        console.log('Creating apk_signing_keys table...');
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS apk_signing_keys (
                id INT AUTO_INCREMENT PRIMARY KEY,
                github_user_id BIGINT UNSIGNED NOT NULL,
                project_name VARCHAR(255) NOT NULL,
                keystore_path VARCHAR(500) NOT NULL,
                key_alias VARCHAR(100) NOT NULL,
                store_password VARCHAR(100) NOT NULL,
                key_password VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY idx_user_project (github_user_id, project_name)
            )
        `);
        console.log('✅ apk_signing_keys table ready');
    } catch (err) {
        console.error('Error:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

run().catch(console.error);
