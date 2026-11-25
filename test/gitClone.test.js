const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cloneRepo, cloneRepoAtCommit, withTransientRetry, isTransientGitError, gitErrorSummary, RETRY_DELAYS_MS } = require('../utils/gitClone');

const TOKEN = 'ghs_TESTTOKEN_should_never_be_logged';

/** Error shaped like the one promisify(execFile) throws: argv in message, git output in stderr. */
function gitError(stderr, { killed = false } = {}) {
    const e = new Error(`Command failed: git -c credential.helper=!f() { echo password=$GIT_TOKEN; }; f clone https://github.com/u/r.git /x\n${stderr}`);
    e.stderr = stderr;
    e.killed = killed;
    e.code = 128;
    return e;
}

const DNS = "Cloning into '/x'...\nfatal: unable to access 'https://github.com/u/r.git/': Could not resolve host: github.com\n";
const NOT_FOUND = "Cloning into '/x'...\nremote: Repository not found.\nfatal: repository 'https://github.com/u/r.git/' not found\n";
const AUTH = "Cloning into '/x'...\nremote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/u/r.git/'\n";
const NO_BRANCH = "Cloning into '/x'...\nwarning: Could not find remote branch nope to clone.\nfatal: Remote branch nope not found in upstream origin\n";

test('retry delays are 3s then 10s', () => {
    assert.deepEqual(RETRY_DELAYS_MS, [3000, 10000]);
});

test('transient vs permanent git errors', () => {
    assert.equal(isTransientGitError(gitError(DNS)), true);
    assert.equal(isTransientGitError(gitError('fatal: unable to access …: Failed to connect to github.com port 443 after 3 ms: Connection refused')), true);
    assert.equal(isTransientGitError(gitError('fatal: unable to access …: The requested URL returned error: 502')), true);
    assert.equal(isTransientGitError(gitError('error: RPC failed; curl 56 GnuTLS recv error (-54)\nfatal: early EOF')), true);
    assert.equal(isTransientGitError(gitError('', { killed: true })), true);
    assert.equal(isTransientGitError(gitError(NOT_FOUND)), false);
    assert.equal(isTransientGitError(gitError(AUTH)), false);
    assert.equal(isTransientGitError(gitError(NO_BRANCH)), false);
    assert.equal(isTransientGitError(gitError('fatal: unable to access …: The requested URL returned error: 403')), false);
});

test('gitErrorSummary keeps only the last git line, never argv', () => {
    const s = gitErrorSummary(gitError(DNS));
    assert.equal(s, "fatal: unable to access 'https://github.com/u/r.git/': Could not resolve host: github.com");
    assert.doesNotMatch(s, /credential\.helper|GIT_TOKEN/);
    assert.equal(gitErrorSummary(gitError('', { killed: true })), 'git timed out');
});

test('withTransientRetry: transient error then success → retried with cleanup', async () => {
    let calls = 0; let cleanups = 0; const waits = []; const retries = [];
    const out = await withTransientRetry(async () => {
        calls++;
        if (calls < 3) throw gitError(DNS);
        return 'ok';
    }, { cleanup: async () => { cleanups++; }, onRetry: (r) => retries.push(r), wait: async (ms) => { waits.push(ms); } });
    assert.equal(out, 'ok');
    assert.equal(calls, 3);
    assert.equal(cleanups, 2);
    assert.deepEqual(waits, [3000, 10000]);
    assert.deepEqual(retries.map(r => [r.attempt, r.total]), [[2, 3], [3, 3]]);
    assert.match(retries[0].reason, /Could not resolve host/);
});

test('withTransientRetry: always transient → 3 attempts, clone_failed, short message', async () => {
    let calls = 0;
    await assert.rejects(
        withTransientRetry(async () => { calls++; throw gitError(DNS); }, { wait: async () => {} }),
        (err) => {
            assert.equal(err.failureStage, 'clone_failed');
            assert.match(err.message, /^Clone failed: fatal: unable to access .*Could not resolve host: github\.com \(after 3 attempts\)$/);
            assert.doesNotMatch(err.message, /credential\.helper|GIT_TOKEN|Command failed/);
            return true;
        }
    );
    assert.equal(calls, 3);
});

test('withTransientRetry: permanent error fails at once, no retry', async () => {
    for (const stderr of [NOT_FOUND, AUTH, NO_BRANCH]) {
        let calls = 0; let retried = false;
        await assert.rejects(
            withTransientRetry(async () => { calls++; throw gitError(stderr); }, { onRetry: () => { retried = true; }, wait: async () => {} }),
            (err) => err.failureStage === 'clone_failed' && !/after/.test(err.message)
        );
        assert.equal(calls, 1);
        assert.equal(retried, false);
    }
});

test('cloneRepo removes the half-cloned directory before retrying and passes the token only via env', async () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-test-'));
    const seen = [];
    let calls = 0;
    const fakeExec = async (cmd, args, opts) => {
        calls++;
        seen.push({ cmd, args, dirExistedWithJunk: fs.existsSync(path.join(dest, 'partial')), token: opts.env.GIT_TOKEN });
        if (calls === 1) {
            fs.mkdirSync(dest, { recursive: true });
            fs.writeFileSync(path.join(dest, 'partial'), 'x'); // what a failed clone leaves behind
            throw gitError(DNS);
        }
        return { stdout: '', stderr: '' };
    };
    await cloneRepo({ githubUsername: 'u', repository: 'r', branch: 'main', githubToken: TOKEN, destPath: dest, _exec: fakeExec, _wait: async () => {} });
    assert.equal(calls, 2);
    assert.equal(seen[1].dirExistedWithJunk, false, 'leftover from the failed attempt must be removed');
    for (const s of seen) {
        assert.equal(s.cmd, 'git');
        assert.equal(s.token, TOKEN);
        assert.ok(!s.args.join(' ').includes(TOKEN), 'token must never be in argv');
    }
    fs.rmSync(dest, { recursive: true, force: true });
});

test('cloneRepoAtCommit retries the clone, then checks out the commit once', async () => {
    const calls = [];
    let cloneCalls = 0;
    const fakeExec = async (cmd, args) => {
        calls.push(args.includes('checkout') ? 'checkout' : 'clone');
        if (!args.includes('checkout') && ++cloneCalls === 1) throw gitError('fatal: unable to access …: The requested URL returned error: 503');
        return { stdout: '', stderr: '' };
    };
    await cloneRepoAtCommit({ githubUsername: 'u', repository: 'r', commit: 'abcdef1', githubToken: TOKEN, destPath: path.join(os.tmpdir(), 'nonexistent-clone-test'), _exec: fakeExec, _wait: async () => {} });
    assert.deepEqual(calls, ['clone', 'clone', 'checkout']);
});
