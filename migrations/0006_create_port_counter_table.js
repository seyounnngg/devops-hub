module.exports = {
    async up(pool) {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS port_counter (
                id TINYINT PRIMARY KEY,
                next_port INT NOT NULL
            )
        `);

        const [maxRows] = await pool.execute('SELECT MAX(port) as maxPort FROM deployments');
        const seed = (maxRows[0].maxPort || 3009) + 1;

        await pool.execute('INSERT IGNORE INTO port_counter (id, next_port) VALUES (1, ?)', [seed]);
    }
};
