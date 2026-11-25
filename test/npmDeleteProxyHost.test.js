const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { deleteProxyHost } = require('../services/NpmProxyManager');

const API = 'http://npm.test:81/api';
const saved = {};

beforeEach(() => {
    for (const k of ['NPM_API_URL', 'NPM_EMAIL', 'NPM_PASSWORD']) saved[k] = process.env[k];
    process.env.NPM_API_URL = API;
    process.env.NPM_EMAIL = 'admin@example.test';
    process.env.NPM_PASSWORD = 'not-a-real-password';
});
afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
});

/**
 * Fake NPM: `hosts` maps endpoint kind → array, `failGet` / `failCertDelete`
 * simulate errors. Records every DELETE.
 */
function fakeNpm(t, { hosts, failGet = null, failCertDelete = false }) {
    const deleted = [];
    t.mock.method(axios, 'post', async (url) => {
        assert.equal(url, `${API}/tokens`);
        return { data: { token: 'tok' } };
    });
    t.mock.method(axios, 'get', async (url) => {
        const kind = url.replace(`${API}/nginx/`, '');
        if (failGet === kind) throw new Error(`GET ${kind} failed`);
        return { data: hosts[kind] || [] };
    });
    t.mock.method(axios, 'delete', async (url) => {
        const path = url.replace(`${API}/nginx/`, '');
        if (failCertDelete && path.startsWith('certificates/')) {
            const e = new Error('Request failed with status code 500');
            e.response = { data: { error: { message: 'internal error' } } };
            throw e;
        }
        deleted.push(path);
        // the proxy disappears from later listings
        if (path.startsWith('proxy-hosts/')) {
            const id = Number(path.split('/')[1]);
            hosts['proxy-hosts'] = hosts['proxy-hosts'].filter(h => h.id !== id);
        }
        return { data: true };
    });
    return deleted;
}

const proxy = (id, domain, certificate_id) => ({ id, domain_names: [domain], certificate_id });

test('deletes the proxy and then its certificate when nothing else uses it', async (t) => {
    const deleted = fakeNpm(t, { hosts: { 'proxy-hosts': [proxy(56, 'k2-test-app.hgu.app', 61), proxy(4, 'hgu.app', 10)] } });
    const logs = [];
    const r = await deleteProxyHost({ projectName: 'k2-test-app', addLog: (m) => logs.push(m) });
    assert.deepEqual(deleted, ['proxy-hosts/56', 'certificates/61']);
    assert.equal(r.proxyDeleted, true);
    assert.equal(r.certificateId, 61);
    assert.equal(r.certificateDeleted, true);
    assert.ok(logs.some(l => l.includes('Deleted certificate #61')));
});

test('keeps the certificate when another proxy host still uses it', async (t) => {
    const deleted = fakeNpm(t, { hosts: { 'proxy-hosts': [proxy(56, 'k2-test-app.hgu.app', 61), proxy(57, 'other.hgu.app', 61)] } });
    const r = await deleteProxyHost({ projectName: 'k2-test-app', addLog: () => {} });
    assert.deepEqual(deleted, ['proxy-hosts/56']);
    assert.equal(r.certificateDeleted, false);
    assert.match(r.certificateKeptReason, /proxy-hosts #57/);
});

test('keeps the certificate when a redirection host / dead host / stream uses it', async (t) => {
    for (const kind of ['redirection-hosts', 'dead-hosts', 'streams']) {
        await t.test(kind, async (tt) => {
            const deleted = fakeNpm(tt, {
                hosts: { 'proxy-hosts': [proxy(56, 'k2-test-app.hgu.app', 61)], [kind]: [{ id: 3, certificate_id: 61 }] }
            });
            const r = await deleteProxyHost({ projectName: 'k2-test-app', addLog: () => {} });
            assert.deepEqual(deleted, ['proxy-hosts/56']);
            assert.match(r.certificateKeptReason, new RegExp(kind));
        });
    }
});

test('does not touch certificates when the proxy had none', async (t) => {
    const deleted = fakeNpm(t, { hosts: { 'proxy-hosts': [proxy(56, 'k2-test-app.hgu.app', 0)] } });
    const r = await deleteProxyHost({ projectName: 'k2-test-app', addLog: () => {} });
    assert.deepEqual(deleted, ['proxy-hosts/56']);
    assert.equal(r.certificateId, null);
});

test('keeps the certificate if usage cannot be checked (safe default)', async (t) => {
    const deleted = fakeNpm(t, {
        hosts: { 'proxy-hosts': [proxy(56, 'k2-test-app.hgu.app', 61)] },
        failGet: 'dead-hosts'
    });
    const r = await deleteProxyHost({ projectName: 'k2-test-app', addLog: () => {} });
    assert.deepEqual(deleted, ['proxy-hosts/56']);
    assert.equal(r.certificateDeleted, false);
    assert.match(r.certificateKeptReason, /could not check/);
});

test('certificate delete failure is logged, never thrown', async (t) => {
    fakeNpm(t, { hosts: { 'proxy-hosts': [proxy(56, 'k2-test-app.hgu.app', 61)] }, failCertDelete: true });
    const logs = [];
    const r = await deleteProxyHost({ projectName: 'k2-test-app', addLog: (m) => logs.push(m) });
    assert.equal(r.proxyDeleted, true);
    assert.equal(r.certificateDeleted, false);
    assert.match(r.certificateKeptReason, /delete failed/);
    assert.ok(logs.some(l => l.includes('Could not delete certificate #61')));
});

test('no matching proxy: nothing deleted', async (t) => {
    const deleted = fakeNpm(t, { hosts: { 'proxy-hosts': [proxy(4, 'hgu.app', 10)] } });
    const r = await deleteProxyHost({ projectName: 'k2-test-app', addLog: () => {} });
    assert.deepEqual(deleted, []);
    assert.equal(r.proxyDeleted, false);
});
