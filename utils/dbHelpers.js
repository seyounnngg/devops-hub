/**
 * Small DB helper utilities.
 * Updated for per-user isolation (github_user_id).
 */
async function safeInsertDeployment(pool, values) {
    const {
        projectName,
        repository,
        branch = null,
        containerName,
        imageName,
        port,
        url,
        status,
        serviceType = 'web',
        apkUrl = null,
        aabUrl = null,
        envVars = null,
        githubUserId = null
    } = values;

    // Current schema (relies on all migrations in migrations/ having been applied —
    // run `npm run migrate` before deploying code that expects a new column).
    try {
        const [result] = await pool.execute(`
            INSERT INTO deployments
            (github_user_id, project_name, repository_name, branch, container_name, image_name, port, url, status, service_type, apk_url, aab_url, env_vars)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [githubUserId, projectName, repository, branch, containerName, imageName, port, url, status, serviceType, apkUrl, aabUrl, envVars ? JSON.stringify(envVars) : null]);
        return result.insertId;
    } catch (err) {
        if (err.code !== 'ER_BAD_FIELD_ERROR') {
            throw err;
        }
        console.warn('[DB] branch/env_vars/aab_url column missing, falling back to older insert shapes...');
    }

    // Older fallback tiers below — kept for environments that haven't run every
    // migration yet. New columns should not need a new tier here; add them to
    // the current-schema insert above once migrations/ has been updated.

    // Full modern insert (includes per-user isolation + apk support)
    try {
        const [result] = await pool.execute(`
            INSERT INTO deployments
            (github_user_id, project_name, repository_name, container_name, image_name, port, url, status, service_type, apk_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [githubUserId, projectName, repository, containerName, imageName, port, url, status, serviceType, apkUrl]);
        return result.insertId;
    } catch (err) {
        if (err.code !== 'ER_BAD_FIELD_ERROR') {
            throw err;
        }
        console.warn('[DB] Some newer columns missing, trying fallback insert with github_user_id...');
    }

    // Fallback 1: include github_user_id + service_type (but no apk_url)
    try {
        const [result] = await pool.execute(`
            INSERT INTO deployments
            (github_user_id, project_name, repository_name, container_name, image_name, port, url, status, service_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [githubUserId, projectName, repository, containerName, imageName, port, url, status, serviceType]);
        return result.insertId;
    } catch (err) {
        if (err.code !== 'ER_BAD_FIELD_ERROR') {
            throw err;
        }
        console.warn('[DB] github_user_id column also missing — final minimal fallback (NO USER ISOLATION for this row)');
    }

    // Last resort: original minimal columns only
    const [result] = await pool.execute(`
        INSERT INTO deployments
        (project_name, repository_name, container_name, image_name, port, url, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [projectName, repository, containerName, imageName, port, url, status]);
    return result.insertId;
}

/** Best-effort — deployment_builds may not exist yet if migrations haven't run. */
async function recordBuild(pool, { deploymentId, commitHash = null, imageName = null, containerName = null, status, triggeredBy = 'manual' }) {
    try {
        await pool.execute(
            `INSERT INTO deployment_builds (deployment_id, commit_hash, image_name, container_name, status, triggered_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [deploymentId, commitHash, imageName, containerName, status, triggeredBy]
        );
    } catch (err) {
        console.error('[DB] Failed to record build history (non-fatal):', err.message);
    }
}

module.exports = {
    safeInsertDeployment,
    recordBuild
};
