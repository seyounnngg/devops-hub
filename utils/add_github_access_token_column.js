/**
 * One-time migration helper.
 *
 * Run this on the server (where you have access to the real DB):
 *
 *   node utils/add_github_access_token_column.js
 *
 * Part of moving to cookie-based sessions: the GitHub OAuth access token
 * (repo-scope!) used to be embedded directly in the JWT payload, which meant
 * it was readable client-side by anyone who could read the JWT (localStorage,
 * XSS, browser history). It now lives only in this column, keyed by the same
 * token_id already stored in the httpOnly session cookie.
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
        console.log('Adding github_access_token column to user_sessions...');

        await pool.execute(`
            ALTER TABLE user_sessions
            ADD COLUMN github_access_token VARCHAR(255) NULL AFTER token_id
        `);
        console.log('✅ github_access_token column added successfully');
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log('ℹ️ Column github_access_token already exists. Nothing to do.');
        } else {
            console.error('Error:', err.message);
            throw err;
        }
    } finally {
        await pool.end();
    }
}

run().catch(console.error);
