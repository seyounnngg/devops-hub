/**
 * K15: which container port should a redeploy / rollback / webhook publish?
 *
 * The first deployment knows it (from the request, or auto-detected for repos
 * without a Dockerfile). Redeploys used to pass nothing, so webDeployer fell
 * back to 80 for any repo with its own Dockerfile — the health check only checks
 * that the container is up, so the switch "succeeded" and the site went 502.
 *
 * Order: stored `deployments.internal_port` → the port the currently running
 * container is published with (covers rows created before the column existed)
 * → undefined (webDeployer keeps its previous behaviour).
 */

function validPort(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/** `docker inspect` HostConfig.PortBindings → the single published container port, or null. */
function internalPortFromBindings(portBindings) {
    if (!portBindings || typeof portBindings !== 'object') return null;
    const tcpPorts = Object.keys(portBindings)
        .map((k) => /^(\d+)\/tcp$/.exec(k))
        .filter(Boolean)
        .map((m) => validPort(m[1]))
        .filter((p) => p !== null);
    // Hub publishes exactly one port per web container; anything else is ambiguous.
    return tcpPorts.length === 1 ? tcpPorts[0] : null;
}

/**
 * @param deployment  row from `deployments`
 * @param inspectPortBindings async (containerName) => PortBindings object (throws/null if unknown)
 * @returns {Promise<{ port: number|undefined, source: 'stored'|'container'|'none' }>}
 */
async function resolveInternalPort(deployment, inspectPortBindings) {
    const stored = validPort(deployment && deployment.internal_port);
    if (stored) return { port: stored, source: 'stored' };

    if (deployment && deployment.container_name && inspectPortBindings) {
        try {
            const fromContainer = internalPortFromBindings(await inspectPortBindings(deployment.container_name));
            if (fromContainer) return { port: fromContainer, source: 'container' };
        } catch (_) { /* container gone or not inspectable — fall through */ }
    }
    return { port: undefined, source: 'none' };
}

/** Best-effort persist; tolerates the column not existing yet (migration not run). */
async function saveInternalPort(pool, deploymentId, port) {
    const p = validPort(port);
    if (!deploymentId || !p) return false;
    try {
        await pool.execute('UPDATE deployments SET internal_port = ? WHERE id = ?', [p, deploymentId]);
        return true;
    } catch (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR') {
            console.warn('[DB] deployments.internal_port missing — run `npm run migrate` (0015). Not saved.');
            return false;
        }
        console.error('[DB] Failed to save internal_port (non-fatal):', err.message);
        return false;
    }
}

module.exports = { internalPortFromBindings, resolveInternalPort, saveInternalPort };
