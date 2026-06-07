/**
 * Small DB helper utilities.
 * Updated for per-user isolation (github_user_id).
 */
async function safeInsertDeployment(pool, values) {
    const {
        projectName,
        repository,
        containerName,
        imageName,
        port,
        url,
        status,
        serviceType = 'web',
        apkUrl = null,
        githubUserId = null
    } = values;

    // Full modern insert (includes per-user isolation + apk support)
    try {
        await pool.execute(`
            INSERT INTO deployments 
            (github_user_id, project_name, repository_name, container_name, image_name, port, url, status, service_type, apk_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [githubUserId, projectName, repository, containerName, imageName, port, url, status, serviceType, apkUrl]);
        return;
    } catch (err) {
        if (err.code !== 'ER_BAD_FIELD_ERROR') {
            throw err;
        }
        console.warn('[DB] Some newer columns missing, trying fallback insert with github_user_id...');
    }

    // Fallback 1: include github_user_id + service_type (but no apk_url)
    try {
        await pool.execute(`
            INSERT INTO deployments 
            (github_user_id, project_name, repository_name, container_name, image_name, port, url, status, service_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [githubUserId, projectName, repository, containerName, imageName, port, url, status, serviceType]);
        return;
    } catch (err) {
        if (err.code !== 'ER_BAD_FIELD_ERROR') {
            throw err;
        }
        console.warn('[DB] github_user_id column also missing — final minimal fallback (NO USER ISOLATION for this row)');
    }

    // Last resort: original minimal columns only
    await pool.execute(`
        INSERT INTO deployments 
        (project_name, repository_name, container_name, image_name, port, url, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [projectName, repository, containerName, imageName, port, url, status]);
}

module.exports = {
    safeInsertDeployment
};
