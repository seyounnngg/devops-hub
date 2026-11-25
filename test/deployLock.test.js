const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const lock = require('../utils/deployLock');

beforeEach(() => lock._reset());

test('second acquire of the same project is refused until released', () => {
    const key = lock.deploymentKey(214);
    const release = lock.tryAcquire(key, 'redeploy');
    assert.equal(typeof release, 'function');
    assert.equal(lock.tryAcquire(key, 'redeploy'), null);
    assert.equal(lock.holder(key).kind, 'redeploy');
    release();
    assert.equal(lock.holder(key), null);
    const again = lock.tryAcquire(key, 'rollback');
    assert.equal(typeof again, 'function');
    again();
});

test('different projects do not block each other', () => {
    const a = lock.tryAcquire(lock.deploymentKey(1));
    const b = lock.tryAcquire(lock.deploymentKey(2));
    assert.ok(a && b);
    a(); b();
});

test('release is idempotent and cannot free a later holder', () => {
    const key = lock.deploymentKey(7);
    const first = lock.tryAcquire(key);
    first();
    const second = lock.tryAcquire(key);
    first(); // stale release must not drop the second holder
    assert.equal(lock.tryAcquire(key), null);
    second();
});

test('create keys are per user and per project name', () => {
    const k1 = lock.createKey(10, 'app');
    const r1 = lock.tryAcquire(k1, 'create');
    assert.equal(lock.tryAcquire(lock.createKey(10, 'app')), null);
    const other = lock.tryAcquire(lock.createKey(11, 'app'));
    assert.ok(other);
    r1(); other();
});

test('pending webhook follow-ups are coalesced and consumed once', () => {
    const key = lock.deploymentKey(216);
    assert.equal(lock.takePending(key), false);
    lock.markPending(key);
    lock.markPending(key);
    assert.equal(lock.takePending(key), true);
    assert.equal(lock.takePending(key), false);
});

test('busyError carries status 409 and the holder kind', () => {
    const key = lock.deploymentKey(5);
    const release = lock.tryAcquire(key, 'rollback');
    const err = lock.busyError(key);
    assert.equal(err.status, 409);
    assert.match(err.message, /rollback/);
    release();
});
