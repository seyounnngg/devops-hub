/**
 * Lightweight migration runner — no new dependency, works directly with the
 * existing mysql2 pool. Not a full framework (no down-migrations); the goal
 * is just to replace "remember to run this script by hand, in the right
 * order, exactly once" with a tracked, idempotent `npm run migrate`.
 *
 * Usage:
 *   node utils/migrate.js          — apply all pending migrations
 *   node utils/migrate.js --status — list applied vs. pending, apply nothing
 *
 * Each file in migrations/ exports `{ up(pool) { ... } }`. Filenames are
 * applied in sorted order (hence the zero-padded numeric prefix) and
 * recorded in `schema_migrations` so re-running is always a no-op for
 * anything already applied.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable(pool) {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            filename VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

function listMigrationFiles() {
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.js'))
        .sort();
}

async function run() {
    const statusOnly = process.argv.includes('--status');

    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        await ensureMigrationsTable(pool);

        const [appliedRows] = await pool.execute('SELECT filename FROM schema_migrations');
        const applied = new Set(appliedRows.map(r => r.filename));

        const files = listMigrationFiles();
        const pending = files.filter(f => !applied.has(f));

        if (statusOnly) {
            files.forEach(f => console.log(`${applied.has(f) ? '✅ applied' : '⏳ pending'}  ${f}`));
            return;
        }

        if (pending.length === 0) {
            console.log('✅ No pending migrations — schema is up to date.');
            return;
        }

        for (const file of pending) {
            console.log(`▶️  Applying ${file}...`);
            const migration = require(path.join(MIGRATIONS_DIR, file));
            await migration.up(pool);
            await pool.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
            console.log(`✅ ${file} applied`);
        }

        console.log(`✅ Done — applied ${pending.length} migration(s).`);
    } finally {
        await pool.end();
    }
}

run().catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
