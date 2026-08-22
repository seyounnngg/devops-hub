module.exports = {
    async up(pool) {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS apk_signing_keys (
                id INT AUTO_INCREMENT PRIMARY KEY,
                github_user_id BIGINT UNSIGNED NOT NULL,
                project_name VARCHAR(255) NOT NULL,
                keystore_path VARCHAR(500) NOT NULL,
                key_alias VARCHAR(100) NOT NULL,
                store_password VARCHAR(100) NOT NULL,
                key_password VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY idx_user_project (github_user_id, project_name)
            )
        `);
    }
};
