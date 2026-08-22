/**
 * Server-side input validation for values that end up as arguments to
 * git / docker commands. Combined with switching exec() -> execFile()/spawn()
 * (which never invokes a shell), this closes the command-injection surface.
 */

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}[A-Za-z0-9]$|^[A-Za-z0-9]$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,198}[A-Za-z0-9]$|^[A-Za-z0-9]$/;

function assertSafeProjectName(name) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) {
        const err = new Error('Invalid project name. Use letters, numbers, dots, dashes or underscores only.');
        err.status = 400;
        throw err;
    }
    return name;
}

function assertSafeRepository(repository) {
    if (typeof repository !== 'string' || !NAME_RE.test(repository)) {
        const err = new Error('Invalid repository name.');
        err.status = 400;
        throw err;
    }
    return repository;
}

function assertSafeBranch(branch) {
    if (typeof branch !== 'string' || !BRANCH_RE.test(branch)) {
        const err = new Error('Invalid branch name.');
        err.status = 400;
        throw err;
    }
    return branch;
}

/** Path segments must not contain shell metacharacters, even though we no
 *  longer shell-interpret them; this protects the apkBuilder Flutter/Gradle
 *  build templates which still run through `sh -c` for the toolchain itself. */
function assertSafePathSegment(segment, label = 'path') {
    if (typeof segment !== 'string' || /["'`$\\;|&<>(){}\n]/.test(segment)) {
        const err = new Error(`Unsafe ${label} detected in cloned repository.`);
        err.status = 400;
        throw err;
    }
    return segment;
}

module.exports = {
    assertSafeProjectName,
    assertSafeRepository,
    assertSafeBranch,
    assertSafePathSegment
};
