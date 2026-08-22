/**
 * Atomic external-port allocator.
 *
 * Replaces the old `SELECT MAX(port)+1` pattern (webDeployer.js / apkBuilder.js),
 * which raced under concurrent deployments and could hand out the same port
 * to two containers. Uses a single-row counter table with SELECT ... FOR UPDATE
 * inside a transaction so concurrent callers serialize instead of colliding.
 *
 * Requires the `port_counter` table — see migrations/0006_create_port_counter_table.js.
 */
async function allocatePort(pool, { startFrom = 3010 } = {}) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        await conn.execute(
            `INSERT IGNORE INTO port_counter (id, next_port) VALUES (1, ?)`,
            [startFrom]
        );

        const [rows] = await conn.execute(`SELECT next_port FROM port_counter WHERE id = 1 FOR UPDATE`);
        const port = rows[0].next_port;

        await conn.execute(`UPDATE port_counter SET next_port = next_port + 1 WHERE id = 1`);

        await conn.commit();
        return port;
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = { allocatePort };
