const { test } = require('node:test');
const assert = require('node:assert/strict');
const { internalPortFromBindings, resolveInternalPort, saveInternalPort } = require('../utils/internalPort');

test('internalPortFromBindings reads the single published tcp port', () => {
    assert.equal(internalPortFromBindings({ '3000/tcp': [{ HostIp: '172.17.0.1', HostPort: '3118' }] }), 3000);
    assert.equal(internalPortFromBindings({ '80/tcp': [{ HostIp: '', HostPort: '3086' }] }), 80);
});

test('internalPortFromBindings refuses empty, ambiguous or non-tcp bindings', () => {
    assert.equal(internalPortFromBindings(null), null);
    assert.equal(internalPortFromBindings({}), null);
    assert.equal(internalPortFromBindings({ '3000/tcp': [], '8080/tcp': [] }), null);
    assert.equal(internalPortFromBindings({ '53/udp': [] }), null);
});

test('resolveInternalPort prefers the stored value', async () => {
    let inspected = false;
    const r = await resolveInternalPort({ internal_port: 8000, container_name: 'web-1' }, async () => { inspected = true; return {}; });
    assert.deepEqual(r, { port: 8000, source: 'stored' });
    assert.equal(inspected, false);
});

test('resolveInternalPort falls back to the running container (rows created before the column)', async () => {
    const r = await resolveInternalPort(
        { internal_port: null, container_name: 'web-1795602342361' },
        async (name) => {
            assert.equal(name, 'web-1795602342361');
            return { '3000/tcp': [{ HostIp: '172.17.0.1', HostPort: '3118' }] };
        }
    );
    assert.deepEqual(r, { port: 3000, source: 'container' });
});

test('resolveInternalPort returns undefined when nothing is known (old behaviour kept)', async () => {
    assert.deepEqual(await resolveInternalPort({ container_name: 'gone' }, async () => { throw new Error('No such container'); }),
        { port: undefined, source: 'none' });
    assert.deepEqual(await resolveInternalPort({}, null), { port: undefined, source: 'none' });
});

test('saveInternalPort writes, and tolerates a missing column', async () => {
    const calls = [];
    const pool = { execute: async (sql, params) => { calls.push(params); return [{}]; } };
    assert.equal(await saveInternalPort(pool, 218, 3000), true);
    assert.deepEqual(calls[0], [3000, 218]);

    const oldSchema = { execute: async () => { const e = new Error('Unknown column'); e.code = 'ER_BAD_FIELD_ERROR'; throw e; } };
    assert.equal(await saveInternalPort(oldSchema, 218, 3000), false);
    assert.equal(await saveInternalPort(pool, 218, 'abc'), false);
});
