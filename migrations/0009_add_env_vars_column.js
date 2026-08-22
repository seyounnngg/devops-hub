module.exports = {
    async up(pool) {
        try {
            await pool.execute(`
                ALTER TABLE deployments
                ADD COLUMN env_vars TEXT NULL AFTER aab_url
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        }
    }
};
