module.exports = {
    async up(pool) {
        try {
            await pool.execute(`
                ALTER TABLE deployments
                ADD COLUMN apk_url TEXT NULL AFTER url
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        }
    }
};
