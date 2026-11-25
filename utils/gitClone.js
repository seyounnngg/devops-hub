/**
 * Shared, injection-safe repository clone helper.
 *
 * Uses execFile (no shell) so branch/repository values can never be
 * interpreted as shell syntax. The GitHub token is passed to git through a
 * credential-helper reading from an environment variable, never as part of
 * argv or the clone URL, so it does not show up in `ps aux` output or in
 * execFile error messages (which include argv, not env).
 *
 * K19: transient network failures (DNS hiccup, connection reset, GitHub 5xx)
 * are retried twice — 3 s and 10 s later — after removing whatever the failed
 * attempt left in destPath. Auth / not-found / bad-branch errors fail at once.
 * 2026-11-25 a ~9 s DNS outage on the router made a queued webhook redeploy
 * fail at clone.
 */
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { assertSafeRepository, assertSafeBranch, assertSafeCommitHash } = require('./validate');

const RETRY_DELAYS_MS = [3000, 10000];

// Network-level failures worth another try. Anything else (401/403/404,
// "Repository not found", "Remote branch … not found", "Authentication failed")
// would fail the same way again.
const TRANSIENT_PATTERNS = [
    /Could not resolve host/i,
    /Failed to connect to/i,
    /Connection timed out/i,
    /Operation timed out/i,
    /Connection reset/i,
    /Connection refused/i,
    /The requested URL returned error: 5\d\d/i,
    /RPC failed/i,
    /early EOF/i,
    /unexpected disconnect/i,
    /gnutls_handshake\(\) failed/i,
    /SSL_ERROR_SYSCALL/i,
    /Temporary failure in name resolution/i
];

/** Last meaningful line of git's stderr (e.g. "fatal: unable to access …: Could not resolve host: github.com"). */
function gitErrorSummary(err) {
    const text = `${err && err.stderr ? err.stderr : ''}`.trim();
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^Cloning into /.test(l));
    if (lines.length) return lines[lines.length - 1];
    if (err && err.killed) return 'git timed out';
    return 'git clone failed';
}

function isTransientGitError(err) {
    if (err && err.killed) return true; // our own timeout — network stalled
    const text = `${err && err.stderr ? err.stderr : ''}\n${err && err.message ? err.message : ''}`;
    return TRANSIENT_PATTERNS.some((re) => re.test(text));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `attempt()` and retry it on transient git errors.
 * `cleanup()` runs before every retry. On final failure throws an Error whose
 * message is the short git error (never argv) with `.failureStage = 'clone_failed'`.
 */
async function withTransientRetry(attempt, {
    cleanup = async () => {},
    onRetry = () => {},
    delays = RETRY_DELAYS_MS,
    wait = sleep
} = {}) {
    const total = delays.length + 1;
    for (let i = 0; ; i++) {
        try {
            return await attempt();
        } catch (err) {
            const summary = gitErrorSummary(err);
            if (i < delays.length && isTransientGitError(err)) {
                onRetry({ attempt: i + 2, total, delayMs: delays[i], reason: summary });
                await cleanup();
                await wait(delays[i]);
                continue;
            }
            const final = new Error(`Clone failed: ${summary}${i > 0 ? ` (after ${i + 1} attempts)` : ''}`);
            final.failureStage = 'clone_failed';
            final.cause = err;
            throw final;
        }
    }
}

function removeDir(destPath) {
    return fs.promises.rm(destPath, { recursive: true, force: true });
}

const credentialHelper = '!f() { echo username=x-access-token; echo password=$GIT_TOKEN; }; f';

/**
 * Clone at a specific commit (for rollback). Requires a full clone — a
 * shallow one won't have the history to check out an arbitrary past commit.
 * Slower than the normal branch-HEAD clone, so only used for rollback.
 */
async function cloneRepoAtCommit({ githubUsername, repository, commit, githubToken, destPath, timeout = 180000, onRetry, _exec = execFileAsync, _wait }) {
    assertSafeRepository(repository);
    assertSafeCommitHash(commit);

    const repoUrl = `https://github.com/${githubUsername}/${repository}.git`;
    const env = { ...process.env, GIT_TOKEN: githubToken };

    await withTransientRetry(() => _exec('git', [
        '-c', `credential.helper=${credentialHelper}`,
        'clone',
        repoUrl,
        destPath
    ], { timeout, env }), { cleanup: () => removeDir(destPath), onRetry, wait: _wait });

    await _exec('git', ['-C', destPath, 'checkout', commit], { timeout: 30000, env });
}

async function cloneRepo({ githubUsername, repository, branch, githubToken, destPath, timeout = 120000, onRetry, _exec = execFileAsync, _wait }) {
    assertSafeRepository(repository);
    assertSafeBranch(branch);

    const repoUrl = `https://github.com/${githubUsername}/${repository}.git`;

    await withTransientRetry(() => _exec('git', [
        '-c', `credential.helper=${credentialHelper}`,
        'clone',
        '--branch', branch,
        '--single-branch',
        '--depth', '1',
        repoUrl,
        destPath
    ], {
        timeout,
        env: { ...process.env, GIT_TOKEN: githubToken }
    }), { cleanup: () => removeDir(destPath), onRetry, wait: _wait });
}

module.exports = { cloneRepo, cloneRepoAtCommit, withTransientRetry, isTransientGitError, gitErrorSummary, RETRY_DELAYS_MS };
