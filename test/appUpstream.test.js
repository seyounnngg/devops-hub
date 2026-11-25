const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_APP_BIND_HOST, appBindHost, publishSpec } = require('../utils/appUpstream');

test('appBindHost defaults to the default bridge gateway', () => {
    assert.equal(DEFAULT_APP_BIND_HOST, '172.17.0.1');
    assert.equal(appBindHost({}), '172.17.0.1');
    assert.equal(appBindHost({ APP_BIND_HOST: '  ' }), '172.17.0.1');
});

test('appBindHost accepts an explicit IPv4 address', () => {
    assert.equal(appBindHost({ APP_BIND_HOST: '172.18.0.1' }), '172.18.0.1');
});

test('appBindHost rejects all-interfaces, hostnames and junk', () => {
    assert.throws(() => appBindHost({ APP_BIND_HOST: '0.0.0.0' }));
    assert.throws(() => appBindHost({ APP_BIND_HOST: 'example.com' }));
    assert.throws(() => appBindHost({ APP_BIND_HOST: '172.17.0.1:80' }));
    assert.throws(() => appBindHost({ APP_BIND_HOST: '256.1.1.1' }));
});

test('publishSpec never publishes on all interfaces', () => {
    assert.equal(publishSpec(3115, 3000, {}), '172.17.0.1:3115:3000');
    assert.equal(publishSpec('3115', '80', {}), '172.17.0.1:3115:80');
});

test('publishSpec rejects invalid ports', () => {
    assert.throws(() => publishSpec(0, 3000, {}));
    assert.throws(() => publishSpec(3115, 70000, {}));
    assert.throws(() => publishSpec('abc', 3000, {}));
});
