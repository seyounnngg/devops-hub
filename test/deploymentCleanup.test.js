const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deleteDeploymentRecords, deleteUserRecords } = require('../utils/deploymentCleanup');

/**
 * Fake mysql2 pool: records every statement, answers from `respond(sql, params)`,
 * and tracks transaction state on the single connection it hands out.
 */
function fakePool(respond) {
    const log = [];
    const conn = {
        state: 'idle',
        released: false,
        async beginTransaction() { this.state = 'tx'; log.push('BEGIN'); },
        async commit() { this.state = 'committed'; log.push('COMMIT'); },
        async rollback() { this.state = 'rolledback'; log.push('ROLLBACK'); },
        release() { this.released = true; },
        async execute(sql, params) {
            const norm = sql.replace(/\s+/g, ' ').trim();
            log.push(norm);
            return respond(norm, params);
        }
    };
    return { log, conn, pool: { getConnection: async () => conn } };
}

const affected = (n) => [{ affectedRows: n }];
const dep = { id: 219, github_user_id: '271898647', project_name: 'k-lock-test' };

test('deletes builds, then the deployment, then logs when no same-name row remains — in one transaction', async () => {
    const { log, conn, pool } = fakePool((sql) => {
        if (sql.startsWith('DELETE FROM deployment_builds')) return affected(5);
        if (sql.startsWith('DELETE FROM deployments')) return affected(1);
        if (sql.startsWith('SELECT COUNT(*)')) return [[{ c: 0 }]];
        if (sql.startsWith('DELETE FROM deployment_logs')) return affected(1);
        throw new Error(`unexpected ${sql}`);
    });
    const r = await deleteDeploymentRecords(pool, dep);
    assert.deepEqual(r, { builds: 5, deployments: 1, logs: 1 });
    assert.deepEqual(log.map(l => l.split(' WHERE')[0]), [
        'BEGIN',
        'DELETE FROM deployment_builds',
        'DELETE FROM deployments',
        'SELECT COUNT(*) AS c FROM deployments',
        'DELETE FROM deployment_logs',
        'COMMIT'
    ]);
    assert.equal(conn.released, true);
});

test('keeps the logs when another deployment row with the same name still exists', async () => {
    const { log, pool } = fakePool((sql, params) => {
        if (sql.startsWith('SELECT COUNT(*)')) {
            assert.deepEqual(params, ['271898647', 'k-lock-test']);
            return [[{ c: 1 }]]; // e.g. an old failed row is deleted while the live project of that name remains
        }
        return affected(1);
    });
    const r = await deleteDeploymentRecords(pool, dep);
    assert.equal(r.logs, 0);
    assert.ok(!log.some(l => l.startsWith('DELETE FROM deployment_logs')));
});

test('rows without an owner or name never touch deployment_logs', async () => {
    const { log, pool } = fakePool(() => affected(0));
    await deleteDeploymentRecords(pool, { id: 1, github_user_id: null, project_name: null });
    assert.ok(!log.some(l => l.includes('deployment_logs') || l.startsWith('SELECT')));
});

test('any failure rolls everything back and releases the connection', async () => {
    const { log, conn, pool } = fakePool((sql) => {
        if (sql.startsWith('DELETE FROM deployments')) throw new Error('lock wait timeout');
        return affected(3);
    });
    await assert.rejects(deleteDeploymentRecords(pool, dep), /lock wait timeout/);
    assert.equal(conn.state, 'rolledback');
    assert.ok(!log.includes('COMMIT'));
    assert.equal(conn.released, true);
});

test('deleteUserRecords removes builds (joined through deployments), logs and deployments of that user', async () => {
    const { log, pool } = fakePool((sql, params) => {
        assert.deepEqual(params, ['271898647']);
        if (sql.startsWith('DELETE b FROM deployment_builds b JOIN deployments d')) return affected(97);
        if (sql.startsWith('DELETE FROM deployment_logs')) return affected(2);
        if (sql.startsWith('DELETE FROM deployments')) return affected(2);
        throw new Error(`unexpected ${sql}`);
    });
    const r = await deleteUserRecords(pool, '271898647');
    assert.deepEqual(r, { builds: 97, deployments: 2, logs: 2 });
    assert.equal(log[0], 'BEGIN');
    assert.equal(log[log.length - 1], 'COMMIT');
    // builds must go before deployments, or the JOIN finds nothing
    const iBuilds = log.findIndex(l => l.startsWith('DELETE b FROM deployment_builds'));
    const iDeps = log.findIndex(l => l.startsWith('DELETE FROM deployments'));
    assert.ok(iBuilds < iDeps);
});
