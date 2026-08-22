module.exports = {
    async up(pool) {
        try {
            await pool.execute(`
                ALTER TABLE user_sessions
                ADD COLUMN github_access_token VARCHAR(255) NULL AFTER token_id
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        }
    }
};
