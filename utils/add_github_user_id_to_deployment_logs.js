/**
 * One-time migration helper.
 *
 * Run this on the server (where you have access to the real DB):
 *
 *   node utils/add_github_user_id_to_deployment_logs.js
 *
 * deployment_logs was keyed globally by project_name only, so two users
 * picking the same project name could read each other's build/runtime logs
 * after a backend restart (the in-memory dictionary has the same fix, keyed
 * by `${githubUserId}:${projectName}` — this migration makes the persisted
 * table match). Re-keys the table to (github_user_id, project_name).
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
        console.log('Adding github_user_id column to deployment_logs...');
        try {
            await pool.execute(`
                ALTER TABLE deployment_logs
                ADD COLUMN github_user_id BIGINT UNSIGNED NULL AFTER deployment_id
            `);
            console.log('✅ github_user_id column added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('ℹ️ Column already exists.');
            } else {
                throw err;
            }
        }

        // Backfill from deployments (best-effort: most recent matching project_name)
        await pool.execute(`
            UPDATE deployment_logs dl
            JOIN (
                SELECT project_name, github_user_id
                FROM deployments d1
                WHERE created_at = (
                    SELECT MAX(created_at) FROM deployments d2 WHERE d2.project_name = d1.project_name
                )
            ) latest ON latest.project_name = dl.project_name
            SET dl.github_user_id = latest.github_user_id
            WHERE dl.github_user_id IS NULL
        `);
        console.log('✅ Backfilled github_user_id where possible');

        // Replace the old (project_name)-only unique key with (github_user_id, project_name)
        const [existing] = await pool.execute(`
            SELECT DISTINCT INDEX_NAME
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'deployment_logs'
              AND COLUMN_NAME = 'project_name'
              AND NON_UNIQUE = 0
        `);

        for (const row of existing) {
            if (row.INDEX_NAME === 'PRIMARY') continue;
            try {
                await pool.execute(`ALTER TABLE deployment_logs DROP INDEX \`${row.INDEX_NAME}\``);
                console.log(`✅ Dropped old unique index ${row.INDEX_NAME}`);
            } catch (e) {
                console.warn(`⚠️ Could not drop index ${row.INDEX_NAME}: ${e.message}`);
            }
        }

        try {
            await pool.execute(`
                ALTER TABLE deployment_logs
                ADD UNIQUE KEY idx_user_project (github_user_id, project_name)
            `);
            console.log('✅ Composite unique key (github_user_id, project_name) added');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME') {
                console.log('ℹ️ Composite unique key already exists.');
            } else {
                throw err;
            }
        }
    } catch (err) {
        console.error('Error:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

run().catch(console.error);
