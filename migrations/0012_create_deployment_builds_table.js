module.exports = {
    async up(pool) {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS deployment_builds (
                id INT AUTO_INCREMENT PRIMARY KEY,
                deployment_id INT NOT NULL,
                commit_hash VARCHAR(64) NULL,
                image_name VARCHAR(255) NULL,
                container_name VARCHAR(255) NULL,
                status VARCHAR(20) NOT NULL,
                triggered_by VARCHAR(20) NOT NULL DEFAULT 'manual',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_deployment_id (deployment_id)
            )
        `);
    }
};
