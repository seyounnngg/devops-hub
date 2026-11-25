/**
 * Per-project deployment lock (in-process).
 *
 * hub-backend runs as a single process, so an in-memory lock is enough and,
 * unlike a DB flag, can never be left stuck by a crash: if the process dies,
 * the deployment it was running dies with it and the lock goes too.
 *
 * Why: two redeploys of the same project running at once each remember the
 * same "previous container", so whichever finishes first leaves its new
 * container orphaned (seen 2026-11-25 with a double-clicked Redeploy), and for
 * projects with a volume several containers would write the same data.
 *
 * Keys:
 *   deploymentKey(id)            — redeploy / rollback / webhook / delete of an existing project
 *   createKey(userId, name)      — first deployment of a project (before it has an id)
 *
 * A webhook push that arrives while the project is busy is not dropped: it is
 * remembered (coalesced — many pushes become one) and run once the current
 * deployment finishes, so the latest commit still ends up deployed.
 */

const active = new Map();   // key -> { kind, since }
const pending = new Set();  // keys with a coalesced follow-up webhook redeploy

function deploymentKey(id) {
    return `deployment:${id}`;
}

function createKey(userId, projectName) {
    return `create:${userId}:${projectName}`;
}

/** Returns a release() function, or null if the key is already held. */
function tryAcquire(key, kind = 'deploy') {
    if (active.has(key)) return null;
    active.set(key, { kind, since: new Date() });
    let released = false;
    return function release() {
        if (released) return;
        released = true;
        active.delete(key);
    };
}

/** { kind, since } of the current holder, or null. */
function holder(key) {
    return active.get(key) || null;
}

function markPending(key) {
    pending.add(key);
}

/** true (and clears it) if a follow-up was requested while the key was held. */
function takePending(key) {
    return pending.delete(key);
}

/** Error with HTTP status 409 describing who holds the lock. */
function busyError(key) {
    const h = holder(key);
    const err = new Error(
        h
            ? `A ${h.kind} of this project has been running since ${h.since.toISOString()}. Wait for it to finish.`
            : 'A deployment of this project is already running. Wait for it to finish.'
    );
    err.status = 409;
    return err;
}

/** For tests only. */
function _reset() {
    active.clear();
    pending.clear();
}

module.exports = {
    deploymentKey,
    createKey,
    tryAcquire,
    holder,
    markPending,
    takePending,
    busyError,
    _reset
};
