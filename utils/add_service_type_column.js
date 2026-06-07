/**
 * One-time migration helper.
 * 
 * Run this on YOUR machine (where you have access to the real DB):
 * 
 *   node utils/add_service_type_column.js
 * 
 * It uses the same .env as the backend.
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
        console.log('Adding service_type column...');
        await pool.execute(`
            ALTER TABLE deployments 
            ADD COLUMN service_type VARCHAR(20) DEFAULT 'web' AFTER status
        `);
        console.log('✅ service_type column added successfully');
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log('ℹ️ Column already exists. Nothing to do.');
        } else {
            console.error('Error:', err.message);
            throw err;
        }
    } finally {
        await pool.end();
    }
}

run().catch(console.error);
