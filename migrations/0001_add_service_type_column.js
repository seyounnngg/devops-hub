module.exports = {
    async up(pool) {
        try {
            await pool.execute(`
                ALTER TABLE deployments
                ADD COLUMN service_type VARCHAR(20) DEFAULT 'web' AFTER status
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        }
    }
};
