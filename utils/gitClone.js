/**
 * Shared, injection-safe repository clone helper.
 *
 * Uses execFile (no shell) so branch/repository values can never be
 * interpreted as shell syntax. The GitHub token is passed to git through a
 * credential-helper reading from an environment variable, never as part of
 * argv or the clone URL, so it does not show up in `ps aux` output or in
 * execFile error messages (which include argv, not env).
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { assertSafeRepository, assertSafeBranch, assertSafeCommitHash } = require('./validate');

/**
 * Clone at a specific commit (for rollback). Requires a full clone — a
 * shallow one won't have the history to check out an arbitrary past commit.
 * Slower than the normal branch-HEAD clone, so only used for rollback.
 */
async function cloneRepoAtCommit({ githubUsername, repository, commit, githubToken, destPath, timeout = 180000 }) {
    assertSafeRepository(repository);
    assertSafeCommitHash(commit);

    const repoUrl = `https://github.com/${githubUsername}/${repository}.git`;
    const credentialHelper = '!f() { echo username=x-access-token; echo password=$GIT_TOKEN; }; f';
    const env = { ...process.env, GIT_TOKEN: githubToken };

    await execFileAsync('git', [
        '-c', `credential.helper=${credentialHelper}`,
        'clone',
        repoUrl,
        destPath
    ], { timeout, env });

    await execFileAsync('git', ['-C', destPath, 'checkout', commit], { timeout: 30000, env });
}

async function cloneRepo({ githubUsername, repository, branch, githubToken, destPath, timeout = 120000 }) {
    assertSafeRepository(repository);
    assertSafeBranch(branch);

    const repoUrl = `https://github.com/${githubUsername}/${repository}.git`;

    // Credential helper prints the token from GIT_TOKEN (env, not argv).
    const credentialHelper = '!f() { echo username=x-access-token; echo password=$GIT_TOKEN; }; f';

    await execFileAsync('git', [
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
    });
}

module.exports = { cloneRepo, cloneRepoAtCommit };
