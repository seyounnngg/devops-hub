module.exports = {
    async up(pool) {
        try {
            await pool.execute(`
                ALTER TABLE deployments
                ADD COLUMN aab_url VARCHAR(500) NULL AFTER apk_url
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        }
    }
};
