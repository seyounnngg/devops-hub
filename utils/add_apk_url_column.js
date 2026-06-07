/**
 * One-time migration helper for apk_url column.
 * Run this on your server:
 *   node utils/add_apk_url_column.js
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
        console.log('Adding apk_url column if not exists...');
        await pool.execute(`
            ALTER TABLE deployments 
            ADD COLUMN apk_url TEXT NULL AFTER url
        `);
        console.log('✅ apk_url column added successfully');
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log('ℹ️ apk_url column already exists.');
        } else {
            console.error('Error:', err.message);
            throw err;
        }
    } finally {
        await pool.end();
    }
}

run().catch(console.error);
