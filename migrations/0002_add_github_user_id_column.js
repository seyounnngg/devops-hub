module.exports = {
    async up(pool) {
        try {
            await pool.execute(`
                ALTER TABLE deployments
                ADD COLUMN github_user_id BIGINT UNSIGNED NULL AFTER id
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        }

        try {
            await pool.execute(`
                ALTER TABLE deployments
                ADD INDEX idx_github_user_id (github_user_id)
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_KEYNAME') throw err;
        }
    }
};
