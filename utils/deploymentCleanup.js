/**
 * K21: remove a deployment's DB history together with the deployment row.
 *
 * Why not FK ON DELETE CASCADE: deployment_logs is keyed by
 * (github_user_id, project_name) — one row per project *name*, reused when a
 * project of the same name is created again — and its deployment_id is only a
 * "latest deployment" hint overwritten on every save. Cascading on it could
 * delete the logs of a live project when an old failed row of the same name is
 * deleted. So the rules live here, in one transaction:
 *
 *   1. deployment_builds  WHERE deployment_id = id
 *   2. deployments        WHERE id = id
 *   3. deployment_logs    for (user, project_name) — only if no other
 *                         deployments row with that user + name remains
 *
 * Docker / NPM / webhook teardown stays in server.js (best-effort, outside the
 * transaction); this only touches the DB, all-or-nothing.
 */

async function inTransaction(pool, fn) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * @returns {Promise<{ builds: number, deployments: number, logs: number }>} rows deleted
 */
async function deleteDeploymentRecords(pool, deployment) {
    const { id, github_user_id: userId, project_name: projectName } = deployment;
    return inTransaction(pool, async (conn) => {
        const [builds] = await conn.execute('DELETE FROM deployment_builds WHERE deployment_id = ?', [id]);
        const [deps] = await conn.execute('DELETE FROM deployments WHERE id = ?', [id]);

        let logs = 0;
        if (userId != null && projectName != null) {
            const [others] = await conn.execute(
                'SELECT COUNT(*) AS c FROM deployments WHERE github_user_id = ? AND project_name = ?',
                [userId, projectName]
            );
            if (Number(others[0].c) === 0) {
                const [l] = await conn.execute(
                    'DELETE FROM deployment_logs WHERE github_user_id = ? AND project_name = ?',
                    [userId, projectName]
                );
                logs = l.affectedRows;
            }
        }
        return { builds: builds.affectedRows, deployments: deps.affectedRows, logs };
    });
}

/**
 * Account deletion (DELETE /me): every build, log and deployment of the user.
 * @returns {Promise<{ builds: number, deployments: number, logs: number }>}
 */
async function deleteUserRecords(pool, userId) {
    return inTransaction(pool, async (conn) => {
        const [builds] = await conn.execute(
            `DELETE b FROM deployment_builds b
             JOIN deployments d ON d.id = b.deployment_id
             WHERE d.github_user_id = ?`,
            [userId]
        );
        const [logs] = await conn.execute('DELETE FROM deployment_logs WHERE github_user_id = ?', [userId]);
        const [deps] = await conn.execute('DELETE FROM deployments WHERE github_user_id = ?', [userId]);
        return { builds: builds.affectedRows, deployments: deps.affectedRows, logs: logs.affectedRows };
    });
}

module.exports = { deleteDeploymentRecords, deleteUserRecords };
