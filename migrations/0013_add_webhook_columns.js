module.exports = {
    async up(pool) {
        try {
            await pool.execute(`
                ALTER TABLE deployments
                ADD COLUMN webhook_secret VARCHAR(100) NULL AFTER branch
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        }
        try {
            await pool.execute(`
                ALTER TABLE deployments
                ADD COLUMN github_webhook_id BIGINT UNSIGNED NULL AFTER webhook_secret
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        }
        try {
            await pool.execute(`
                ALTER TABLE deployments
                ADD INDEX idx_github_webhook_id (github_webhook_id)
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_KEYNAME') throw err;
        }
    }
};
