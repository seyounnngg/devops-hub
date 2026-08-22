/**
 * One-time migration helper.
 *
 * Run this on the server (where you have access to the real DB):
 *
 *   node utils/add_aab_url_column.js
 *
 * Adds the column that stores the path to a build's signed Android App
 * Bundle (.aab), alongside the existing apk_url.
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
        console.log('Adding aab_url column to deployments...');
        await pool.execute(`
            ALTER TABLE deployments
            ADD COLUMN aab_url VARCHAR(500) NULL AFTER apk_url
        `);
        console.log('✅ aab_url column added successfully');
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log('ℹ️ Column aab_url already exists. Nothing to do.');
        } else {
            console.error('Error:', err.message);
            throw err;
        }
    } finally {
        await pool.end();
    }
}

run().catch(console.error);
