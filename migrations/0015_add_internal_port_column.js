// K15: remember the container port a web deployment listens on, so redeploy /
// rollback / webhook reuse it instead of falling back to 80 for repos that ship
// their own Dockerfile.
module.exports = {
    async up(pool) {
        try {
            await pool.execute(`
                ALTER TABLE deployments
                ADD COLUMN internal_port INT NULL AFTER port
            `);
        } catch (err) {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        }
    }
};
