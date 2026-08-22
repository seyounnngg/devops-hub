/**
 * One-time migration helper.
 *
 * Run this on the server (where you have access to the real DB):
 *
 *   node utils/create_port_counter_table.js
 *
 * Creates the port_counter table used by utils/allocatePort.js for atomic
 * external-port allocation, seeded from the highest port already in use so
 * existing deployments are not affected.
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
        console.log('Creating port_counter table...');
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS port_counter (
                id TINYINT PRIMARY KEY,
                next_port INT NOT NULL
            )
        `);
        console.log('✅ port_counter table ready');

        const [maxRows] = await pool.execute('SELECT MAX(port) as maxPort FROM deployments');
        const seed = (maxRows[0].maxPort || 3009) + 1;

        await pool.execute('INSERT IGNORE INTO port_counter (id, next_port) VALUES (1, ?)', [seed]);
        console.log(`✅ port_counter seeded at ${seed} (based on current MAX(port))`);
    } catch (err) {
        console.error('Error:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

run().catch(console.error);
