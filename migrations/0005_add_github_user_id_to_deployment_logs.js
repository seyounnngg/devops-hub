module.exports = {
    async up(pool) {
        try {
            await pool.execute(`
                ALTER TABLE deployment_logs
                ADD COLUMN github_user_id BIGINT UNSIGNED NULL AFTER deployment_id
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
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
            } catch (e) {
                console.warn(`⚠️ Could not drop index ${row.INDEX_NAME}: ${e.message}`);
            }
        }

        try {
            await pool.execute(`
                ALTER TABLE deployment_logs
                ADD UNIQUE KEY idx_user_project (github_user_id, project_name)
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_KEYNAME') throw err;
        }
    }
};
