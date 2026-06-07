/**
 * One-time migration helper.
 * 
 * Run this on the server (where you have access to the real DB):
 * 
 *   node utils/add_github_user_id_column.js
 * 
 * It uses the same .env as the backend.
 * 
 * This adds per-user isolation support for "Plan B" (each GitHub user sees only their own deployments).
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
        console.log('Adding github_user_id column for per-user data isolation...');
        
        await pool.execute(`
            ALTER TABLE deployments 
            ADD COLUMN github_user_id BIGINT UNSIGNED NULL AFTER id
        `);
        console.log('✅ github_user_id column added successfully');

        // Optional: add index for fast per-user queries
        try {
            await pool.execute(`
                ALTER TABLE deployments 
                ADD INDEX idx_github_user_id (github_user_id)
            `);
            console.log('✅ Index on github_user_id added');
        } catch (idxErr) {
            if (idxErr.code === 'ER_DUP_KEYNAME') {
                console.log('ℹ️ Index already exists.');
            } else {
                console.warn('Index creation warning:', idxErr.message);
            }
        }

    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log('ℹ️ Column github_user_id already exists. Nothing to do.');
        } else {
            console.error('Error:', err.message);
            throw err;
        }
    } finally {
        await pool.end();
    }
}

run().catch(console.error);
