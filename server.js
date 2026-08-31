const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const path = require('path');

require('dotenv').config();

const fs = require('fs');

const { assertSafeProjectName, assertSafeRepository, assertSafeBranch, assertSafeDomain } = require('./utils/validate');
const { verifyWebhookSignature } = require('./utils/verifyWebhookSignature');

// Ensure directories that will be used for builds and APK artifacts
const APK_DIR = '/tmp/apks';
const APK_BUILD_DIR = '/tmp/apk-builds';
[APK_DIR, APK_BUILD_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log('Created directory:', dir);
    }
});

// === Modular deployment system (Web + APK only — Function/Cron removed, see services/README.md) ===
const { deployProject } = require('./services/deploymentDispatcher');

const app = express();

// Trust the reverse proxy (Nginx Proxy Manager / Cloudflare) so req.secure and req.protocol are correct
app.set('trust proxy', 1);

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://hgu.app';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.hgu.app';
const COOKIE_SECURE = (process.env.COOKIE_SECURE || 'true').toLowerCase() !== 'false';

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
// Keep the raw bytes around too — GitHub webhook signatures are computed over
// the exact bytes it sent, which a re-serialized copy of req.body won't match.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(cookieParser());

const MAX_CONCURRENT_DEPLOYMENTS_PER_USER = Number(process.env.MAX_CONCURRENT_DEPLOYMENTS_PER_USER || 5);

const deployLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Prefer the authenticated user id so one account can't dodge the limit
        // by cycling connections; fall back to IP for unauthenticated hits.
        try {
            const authHeader = req.headers.authorization;
            const token = req.cookies?.session || (authHeader ? authHeader.split(' ')[1] : null);
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                return `user:${decoded.id}`;
            }
        } catch (_) { /* fall through to IP */ }
        return ipKeyGenerator(req.ip);
    },
    message: { error: 'Too many deployment requests. Please wait a few minutes and try again.' }
});

const deploymentLogs = {};
global.deploymentLogs = deploymentLogs;

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

function logsKey(githubUserId, projectName) {
    return `${githubUserId}:${projectName}`;
}

// Persist deployment logs to DB so they survive backend restarts and deployment deletion
async function persistDeploymentLogs(githubUserId, projectName) {
    const key = logsKey(githubUserId, projectName);
    if (!projectName || !deploymentLogs[key]) return;

    try {
        const logsJson = JSON.stringify(deploymentLogs[key]);

        const [rows] = await pool.execute(
            `SELECT id FROM deployments
             WHERE project_name = ? AND github_user_id = ?
             ORDER BY created_at DESC
             LIMIT 1`,
            [projectName, githubUserId]
        );

        const deploymentId = rows.length > 0 ? rows[0].id : null;

        await pool.execute(
            `INSERT INTO deployment_logs (deployment_id, github_user_id, project_name, logs, updated_at)
             VALUES (?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
                deployment_id = VALUES(deployment_id),
                logs = VALUES(logs),
                updated_at = NOW()`,
            [deploymentId, githubUserId, projectName, logsJson]
        );
    } catch (err) {
        console.error('Failed to persist deployment logs for', projectName, err.message);
    }
}
global.persistDeploymentLogs = persistDeploymentLogs;

// Preload persisted logs from DB at startup (per-user keyed, see migrations/0005_add_github_user_id_to_deployment_logs.js)
(async () => {
    try {
        const [rows] = await pool.execute(
            `SELECT github_user_id, project_name, logs FROM deployment_logs WHERE github_user_id IS NOT NULL ORDER BY updated_at DESC`
        );
        let loaded = 0;
        for (const row of rows) {
            if (!row.project_name || !row.logs || !row.github_user_id) continue;
            try {
                let raw = row.logs;
                let parsed;
                if (Array.isArray(raw)) parsed = raw;
                else if (Buffer.isBuffer(raw)) parsed = JSON.parse(raw.toString('utf8'));
                else if (typeof raw === 'string') parsed = JSON.parse(raw);
                else parsed = [];

                const key = logsKey(row.github_user_id, row.project_name);
                if (Array.isArray(parsed) && (!deploymentLogs[key] || deploymentLogs[key].length === 0)) {
                    deploymentLogs[key] = parsed;
                    loaded++;
                }
            } catch (pe) {
                console.error('[logs] Bad persisted entry for', row.project_name, pe.message);
            }
        }
        if (loaded > 0) {
            console.log(`[logs] Preloaded ${loaded} project log history/histories from DB.`);
        }
    } catch (e) {
        console.error('[logs] Preload of deployment_logs failed:', e.message);
    }
})();

// Auth: reads the session from the httpOnly cookie (preferred) or a Bearer
// header (kept as a transitional fallback), validates it against the
// active-sessions table, and returns the GitHub access token alongside the
// user — the token itself never leaves the server (it is not embedded in
// the JWT/cookie payload).
async function getAuthenticatedUser(req) {
    const token = req.cookies?.session || (req.headers.authorization ? req.headers.authorization.split(' ')[1] : null);

    if (!token) {
        const err = new Error('No authentication token');
        err.status = 401;
        throw err;
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
        const err = new Error('Invalid or expired token');
        err.status = 401;
        throw err;
    }

    if (!decoded.token_id) {
        const err = new Error('Invalid session');
        err.status = 401;
        throw err;
    }

    const [rows] = await pool.execute(
        `SELECT github_access_token FROM user_sessions
         WHERE github_user_id = ? AND token_id = ? AND expires_at > NOW()
         LIMIT 1`,
        [decoded.id, decoded.token_id]
    );

    if (rows.length === 0) {
        const err = new Error('Session has been invalidated (logged out from another device)');
        err.status = 401;
        err.code = 'SESSION_INVALIDATED';
        throw err;
    }

    return {
        id: decoded.id,
        username: decoded.username,
        token_id: decoded.token_id,
        github_access_token: rows[0].github_access_token
    };
}

/**
 * For flows with no JWT to decode from (GitHub webhook deliveries, background
 * cleanup) — finds this user's most recently-issued still-valid session token
 * and fetches their current username live (user_sessions doesn't store it;
 * only the per-login JWT does, and that isn't available here).
 * Returns null if the user has no active session anywhere (fully logged out).
 */
async function getLatestGithubIdentity(githubUserId) {
    const [rows] = await pool.execute(
        `SELECT github_access_token FROM user_sessions
         WHERE github_user_id = ? AND expires_at > NOW() AND github_access_token IS NOT NULL
         ORDER BY expires_at DESC LIMIT 1`,
        [githubUserId]
    );
    if (rows.length === 0) return null;

    const github_access_token = rows[0].github_access_token;
    try {
        const userResp = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${github_access_token}` },
            timeout: 10000
        });
        return { id: githubUserId, username: userResp.data.login, github_access_token };
    } catch (e) {
        console.error(`Could not fetch GitHub username for user ${githubUserId}:`, e.message);
        return null;
    }
}

function sessionCookieOptions() {
    return {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: 'lax',
        domain: COOKIE_DOMAIN,
        path: '/',
        maxAge: 24 * 60 * 60 * 1000 // 1 day
    };
}

async function dockerStop(containerName) {
    return execFileAsync('docker', ['stop', containerName]).catch(() => {});
}
async function dockerRm(containerName) {
    return execFileAsync('docker', ['rm', containerName]).catch(() => {});
}
async function dockerRmi(imageName) {
    return execFileAsync('docker', ['rmi', imageName]).catch(() => {});
}

/** Best-effort teardown of everything owned by one deployment row. Shared by
 *  DELETE /deployments/:id and DELETE /me. */
async function removeDeploymentResources(deployment) {
    if (deployment.container_name) {
        await dockerStop(deployment.container_name);
        await dockerRm(deployment.container_name);
    }
    if (deployment.image_name) {
        await dockerRmi(deployment.image_name);
    }

    try {
        const { deleteProxyHost } = require('./services/NpmProxyManager');
        await deleteProxyHost({ projectName: deployment.project_name, addLog: (m) => console.log(m) });
    } catch (npmErr) {
        console.error('NPM Proxy Host cleanup error (non-fatal):', npmErr.message);
    }

    if (deployment.github_webhook_id) {
        try {
            const identity = await getLatestGithubIdentity(deployment.github_user_id);
            if (identity) {
                const { deleteWebhook } = require('./utils/githubWebhook');
                await deleteWebhook({
                    githubToken: identity.github_access_token,
                    githubUsername: identity.username,
                    repository: deployment.repository_name,
                    webhookId: deployment.github_webhook_id
                });
            }
        } catch (hookErr) {
            console.error('GitHub webhook cleanup error (non-fatal):', hookErr.message);
        }
    }

    if (deployment.apk_url) {
        try {
            const apkPath = path.join('/tmp/apks', path.basename(deployment.apk_url));
            if (fs.existsSync(apkPath)) fs.unlinkSync(apkPath);
        } catch (e) {
            console.error('APK file cleanup error (non-fatal):', e.message);
        }
    }
    if (deployment.aab_url) {
        try {
            const aabPath = path.join('/tmp/apks', path.basename(deployment.aab_url));
            if (fs.existsSync(aabPath)) fs.unlinkSync(aabPath);
        } catch (e) {
            console.error('AAB file cleanup error (non-fatal):', e.message);
        }
    }
}

app.get('/', (req, res) => {
    res.send('Backend Server Running');
});

// Lightweight session check for the frontend to know if it's logged in
// (replaces the old localStorage-token check now that the session lives in
// an httpOnly cookie the frontend JS cannot read directly).
app.get('/me', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        res.json({ id: user.id, username: user.username });
    } catch (error) {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

// Permanently delete everything belonging to the current user.
app.delete('/me', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);

        const [deployments] = await pool.execute(
            'SELECT * FROM deployments WHERE github_user_id = ?',
            [user.id]
        );

        for (const deployment of deployments) {
            await removeDeploymentResources(deployment);
        }

        await pool.execute('DELETE FROM deployment_logs WHERE github_user_id = ?', [user.id]);
        await pool.execute('DELETE FROM deployments WHERE github_user_id = ?', [user.id]);
        await pool.execute('DELETE FROM user_sessions WHERE github_user_id = ?', [user.id]);

        res.clearCookie('session', sessionCookieOptions());
        res.json({ success: true });
    } catch (error) {
        console.error('DELETE /me error:', error);
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        res.status(500).json({ error: 'Failed to delete account data' });
    }
});

// Logout: invalidates ALL sessions for this user (cross-device logout)
app.post('/auth/logout', async (req, res) => {
    try {
        const token = req.cookies?.session || (req.headers.authorization ? req.headers.authorization.split(' ')[1] : null);
        if (!token) {
            res.clearCookie('session', sessionCookieOptions());
            return res.json({ success: true });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (e) {
            res.clearCookie('session', sessionCookieOptions());
            return res.json({ success: true });
        }

        await pool.execute('DELETE FROM user_sessions WHERE github_user_id = ?', [decoded.id]);

        res.clearCookie('session', sessionCookieOptions());
        res.json({ success: true, message: 'Logged out from all devices' });
    } catch (err) {
        console.error('Logout error:', err);
        res.clearCookie('session', sessionCookieOptions());
        res.json({ success: true });
    }
});

app.get('/auth/logout', (req, res) => {
    res.clearCookie('session', sessionCookieOptions());
    const githubLogoutUrl = `https://github.com/logout?return_to=${encodeURIComponent(`${FRONTEND_URL}/`)}`;
    res.redirect(githubLogoutUrl);
});

app.get('/auth/github', (req, res) => {
    const scopes = 'read:user,user:email,repo';

    const forceReauth = req.query.force === 'true';
    const prompt = forceReauth ? '&prompt=consent' : '';

    // CSRF protection: random state tied to a short-lived cookie, verified on callback.
    const state = crypto.randomUUID();
    res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000
    });

    const redirectUri =
        'https://github.com/login/oauth/authorize'
        + `?client_id=${process.env.GITHUB_CLIENT_ID}`
        + `&scope=${scopes}`
        + `&state=${state}`
        + prompt;

    res.redirect(redirectUri);
});

app.get('/auth/github/callback', async (req, res) => {
    const { code, state } = req.query;
    const expectedState = req.cookies?.oauth_state;

    res.clearCookie('oauth_state');

    if (!state || !expectedState || state !== expectedState) {
        return res.status(401).json({ error: 'Invalid OAuth state (possible CSRF attempt). Please try logging in again.' });
    }

    try {
        const tokenResponse = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code
            },
            { headers: { Accept: 'application/json' } }
        );

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const user = userResponse.data;
        const githubUserId = user.id;

        const tokenId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day

        // GitHub token lives server-side only, keyed by token_id — never sent to the browser.
        await pool.execute(
            `INSERT INTO user_sessions (github_user_id, token_id, github_access_token, expires_at)
             VALUES (?, ?, ?, ?)`,
            [githubUserId, tokenId, accessToken, expiresAt]
        );

        const sessionJwt = jwt.sign(
            { id: githubUserId, username: user.login, token_id: tokenId },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.cookie('session', sessionJwt, sessionCookieOptions());
        res.redirect(`${FRONTEND_URL}/dashboard`);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'GitHub OAuth Failed' });
    }
});

// GitHub paginates /user/repos at 100/page max; a repo count above that means a single
// request silently truncates the list, so follow the Link header's rel="next" until GitHub
// stops sending one.
async function fetchAllGithubRepos(accessToken) {
    const repos = [];
    let url = 'https://api.github.com/user/repos?per_page=100';

    while (url) {
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        repos.push(...response.data);

        const linkHeader = response.headers.link;
        const nextMatch = linkHeader && linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        url = nextMatch ? nextMatch[1] : null;
    }

    return repos;
}

app.get('/repositories', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);

        const repos = await fetchAllGithubRepos(user.github_access_token);

        res.json(repos);
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        console.error("Failed to fetch GitHub repositories:", error?.response?.data || error.message || error);
        res.status(500).json({
            error: 'Failed to fetch repositories from GitHub',
            details: error?.response?.data?.message || error.message || 'Unknown error'
        });
    }
});

function parsePagination(req) {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    return { limit, offset };
}

// Temporary compatibility endpoint (user-scoped)
app.get('/projects', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const { limit, offset } = parsePagination(req);
        // mysql2's execute() (binary prepared-statement protocol) rejects LIMIT/OFFSET as
        // bound params ("Incorrect arguments to mysqld_stmt_execute"). limit/offset are
        // already clamped to integers by parsePagination(), so inlining them is safe.
        const [rows] = await pool.execute(
            `SELECT * FROM deployments WHERE github_user_id = ? ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
            [user.id]
        );
        res.json(rows);
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        console.error('GET /projects error:', error);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

app.post('/projects', deployLimiter, async (req, res) => {
    let projectNameFromBody = req.body?.name;

    try {
        console.log('DEPLOY START');

        const {
            name,
            repository,
            branch,
            serviceType = 'web',
            // Web specific
            internalPort,
            envVars
        } = req.body;

        const decoded = await getAuthenticatedUser(req); // throws on missing/invalid (401)

        assertSafeProjectName(name);
        assertSafeRepository(repository);
        assertSafeBranch(branch);

        if (!['web', 'apk'].includes(serviceType)) {
            return res.status(400).json({ error: `Unsupported serviceType: ${serviceType}` });
        }

        const [countRows] = await pool.execute(
            `SELECT COUNT(*) as c FROM deployments WHERE github_user_id = ? AND status NOT IN ('stopped', 'failed')`,
            [decoded.id]
        );
        if (countRows[0].c >= MAX_CONCURRENT_DEPLOYMENTS_PER_USER) {
            return res.status(429).json({
                error: `You have reached the limit of ${MAX_CONCURRENT_DEPLOYMENTS_PER_USER} active deployments. Stop or delete one before creating another.`
            });
        }

        const [existingRows] = await pool.execute(
            `SELECT id FROM deployments WHERE github_user_id = ? AND project_name = ? AND status != 'failed' LIMIT 1`,
            [decoded.id, name]
        );
        if (existingRows.length > 0) {
            return res.status(409).json({
                error: `You already have a project named "${name}". Use Redeploy from its detail page to update it.`
            });
        }

        const projectName = name;
        const key = logsKey(decoded.id, projectName);
        deploymentLogs[key] = [];
        const addLog = (message) => {
            console.log(message);
            deploymentLogs[key].push(message);
        };

        const githubToken = decoded.github_access_token;
        const githubUsername = decoded.username;
        const githubUserId = decoded.id;

        addLog(`🚀 Deployment started (serviceType: ${serviceType}) for user #${githubUserId}`);

        const result = await deployProject(
            {
                name: projectName,
                repository,
                branch,
                serviceType,
                githubToken,
                githubUsername,
                githubUserId,
                pool,
                internalPort,
                envVars
            },
            {
                addLog,
                onComplete: () => {},
                onError: (err) => {
                    addLog(`❌ Error during deployment: ${err.message}`);
                }
            }
        );

        await persistDeploymentLogs(decoded.id, projectName);

        res.json(result);
    } catch (error) {
        console.error(error);

        if (projectNameFromBody) {
            try {
                const user = await getAuthenticatedUser(req);
                await persistDeploymentLogs(user.id, projectNameFromBody);
            } catch (_) { /* not authenticated / already failed above */ }
        }

        const status = error.status || 500;
        res.status(status).json({
            error: status === 401 ? 'Authentication required' : (status === 400 ? error.message : 'Deployment failed'),
            message: error.message
        });
    }
});

app.get('/deployments', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const { limit, offset } = parsePagination(req);
        // mysql2's execute() (binary prepared-statement protocol) rejects LIMIT/OFFSET as
        // bound params ("Incorrect arguments to mysqld_stmt_execute"). limit/offset are
        // already clamped to integers by parsePagination(), so inlining them is safe.
        const [rows] = await pool.execute(
            `SELECT * FROM deployments WHERE github_user_id = ? ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
            [user.id]
        );
        res.json(rows);
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required. Please log in with GitHub.' });
        }
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch deployments' });
    }
});

app.get('/deployments/:id', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const [rows] = await pool.execute(
            `SELECT * FROM deployments WHERE id = ? AND github_user_id = ?`,
            [req.params.id, user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch deployment' });
    }
});

app.get('/deployments/:name/logs', async (req, res) => {
    let user;
    try {
        user = await getAuthenticatedUser(req);
    } catch (e) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const projectName = req.params.name;
    const key = logsKey(user.id, projectName);

    // 1. Prefer in-memory (namespaced per user — fixes the cross-tenant log leak)
    let current = deploymentLogs[key];
    if (!current || current.length === 0) {
        // 2. Seed from persisted DB, scoped to this user
        try {
            const [rows] = await pool.execute(
                `SELECT logs FROM deployment_logs WHERE project_name = ? AND github_user_id = ? LIMIT 1`,
                [projectName, user.id]
            );
            if (rows.length > 0) {
                let raw = rows[0].logs;
                let parsed;
                if (Array.isArray(raw)) parsed = raw;
                else if (Buffer.isBuffer(raw)) parsed = JSON.parse(raw.toString('utf8'));
                else if (typeof raw === 'string') parsed = JSON.parse(raw);
                else parsed = [];

                if (Array.isArray(parsed)) {
                    deploymentLogs[key] = parsed;
                    current = parsed;
                }
            }
        } catch (err) {
            console.error('Failed to load persisted logs for', projectName, err.message);
        }
    }

    const toReturn = current || [];

    persistDeploymentLogs(user.id, projectName).catch(() => {});

    res.json(toReturn);
});

// Authenticated APK/AAB download (replaces the old unauthenticated /apks static route)
async function downloadMobileArtifact(req, res, { column, label }) {
    try {
        const user = await getAuthenticatedUser(req);
        const [rows] = await pool.execute(
            'SELECT * FROM deployments WHERE id = ? AND github_user_id = ?',
            [req.params.id, user.id]
        );

        if (rows.length === 0 || !rows[0][column]) {
            return res.status(404).json({ error: `${label} not found` });
        }

        const filePath = path.join('/tmp/apks', path.basename(rows[0][column]));
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `${label} file no longer available` });
        }

        res.download(filePath);
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        console.error(error);
        res.status(500).json({ error: `Failed to download ${label}` });
    }
}

app.get('/deployments/:id/apk', (req, res) => downloadMobileArtifact(req, res, { column: 'apk_url', label: 'APK' }));
app.get('/deployments/:id/aab', (req, res) => downloadMobileArtifact(req, res, { column: 'aab_url', label: 'AAB' }));

// Stored env vars are picked up the next time this project is (re)deployed.
app.put('/deployments/:id/env', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const { envVars } = req.body;

        if (envVars !== null && (typeof envVars !== 'object' || Array.isArray(envVars))) {
            return res.status(400).json({ error: 'envVars must be an object of key/value strings, or null to clear it' });
        }

        const [rows] = await pool.execute(
            'SELECT id FROM deployments WHERE id = ? AND github_user_id = ?',
            [req.params.id, user.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found or access denied' });
        }

        const value = envVars && Object.keys(envVars).length > 0 ? JSON.stringify(envVars) : null;
        await pool.execute('UPDATE deployments SET env_vars = ? WHERE id = ?', [value, req.params.id]);

        res.json({ success: true });
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        console.error(error);
        res.status(500).json({ error: 'Failed to update environment variables' });
    }
});

app.post('/deployments/:id/domain', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const customDomain = assertSafeDomain(req.body.customDomain);

        const [rows] = await pool.execute(
            'SELECT * FROM deployments WHERE id = ? AND github_user_id = ?',
            [req.params.id, user.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found or access denied' });
        }
        const deployment = rows[0];
        if (deployment.service_type !== 'web' || !deployment.port) {
            return res.status(400).json({ error: 'Custom domains are only supported for running Web deployments' });
        }

        const { addCustomDomain } = require('./services/NpmProxyManager');
        const result = await addCustomDomain({
            projectName: deployment.project_name,
            customDomain,
            forwardPort: deployment.port,
            addLog: (m) => console.log(m)
        });

        if (!result.success) {
            return res.status(502).json({ error: result.error || 'Failed to attach domain' });
        }

        await pool.execute('UPDATE deployments SET custom_domain = ? WHERE id = ?', [customDomain, req.params.id]);
        res.json({ success: true, url: result.url });
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        if (error.status === 400) {
            return res.status(400).json({ error: error.message });
        }
        console.error(error);
        res.status(500).json({ error: 'Failed to attach custom domain' });
    }
});

app.delete('/deployments/:id/domain', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const [rows] = await pool.execute(
            'SELECT * FROM deployments WHERE id = ? AND github_user_id = ?',
            [req.params.id, user.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found or access denied' });
        }
        const deployment = rows[0];
        if (!deployment.custom_domain) {
            return res.json({ success: true });
        }

        const { removeCustomDomain } = require('./services/NpmProxyManager');
        await removeCustomDomain({
            projectName: deployment.project_name,
            customDomain: deployment.custom_domain,
            addLog: (m) => console.log(m)
        });

        await pool.execute('UPDATE deployments SET custom_domain = NULL WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        console.error(error);
        res.status(500).json({ error: 'Failed to remove custom domain' });
    }
});

/** Shared by /redeploy and /rollback — both are "build this commit and swap it in for
 *  the currently-running container", they only differ in which commit and how it's logged. */
async function runRedeploy(user, deployment, { commitOverride = null, triggeredBy = 'manual' } = {}) {
    const key = logsKey(user.id, deployment.project_name);
    deploymentLogs[key] = [];
    const addLog = (message) => {
        console.log(message);
        deploymentLogs[key].push(message);
    };

    let envVars = null;
    try {
        envVars = deployment.env_vars ? JSON.parse(deployment.env_vars) : null;
    } catch (_) { /* ignore malformed stored env_vars */ }

    addLog(`🚀 ${triggeredBy === 'rollback' ? 'Rollback' : 'Redeploy'} started for ${deployment.project_name}`);

    const result = await deployProject(
        {
            name: deployment.project_name,
            repository: deployment.repository_name,
            branch: deployment.branch,
            serviceType: 'web',
            githubToken: user.github_access_token,
            githubUsername: user.username,
            githubUserId: user.id,
            pool,
            envVars,
            existingDeployment: deployment,
            commitOverride,
            triggeredBy
        },
        {
            addLog,
            onComplete: () => {},
            onError: (err) => addLog(`❌ Error during deployment: ${err.message}`)
        }
    );

    await persistDeploymentLogs(user.id, deployment.project_name);
    return result;
}

// GitHub push webhook — public (no session), self-authenticated via a
// per-deployment HMAC secret. X-GitHub-Hook-ID identifies *which* deployment's
// secret to check (it's just a lookup key, not itself a trust boundary — an
// attacker who guesses/forges it still can't produce a valid signature
// without knowing that deployment's randomly-generated secret).
app.post('/webhooks/github', async (req, res) => {
    const hookId = req.headers['x-github-hook-id'];
    const signature = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];

    if (!hookId || !signature || !req.rawBody) {
        return res.status(400).json({ error: 'Missing webhook headers' });
    }

    let deployment;
    try {
        const [rows] = await pool.execute('SELECT * FROM deployments WHERE github_webhook_id = ? LIMIT 1', [hookId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Unknown webhook' });
        }
        deployment = rows[0];
    } catch (e) {
        console.error('[webhook] DB lookup failed:', e.message);
        return res.status(500).json({ error: 'Internal error' });
    }

    if (!verifyWebhookSignature({ rawBody: req.rawBody, signatureHeader: signature, secret: deployment.webhook_secret })) {
        return res.status(401).json({ error: 'Invalid signature' });
    }

    if (event === 'ping') {
        return res.json({ success: true, message: 'pong' });
    }
    if (event !== 'push') {
        return res.json({ success: true, message: `ignored (${event} event)` });
    }

    const pushedBranch = (req.body?.ref || '').replace('refs/heads/', '');
    if (pushedBranch !== deployment.branch) {
        return res.json({ success: true, message: `ignored (push to ${pushedBranch}, this deployment tracks ${deployment.branch})` });
    }

    const identity = await getLatestGithubIdentity(deployment.github_user_id);
    if (!identity) {
        console.error(`[webhook] No active session for user ${deployment.github_user_id} — cannot auto-redeploy ${deployment.project_name}. They need to log in again.`);
        return res.json({ success: true, message: 'No active session for this project\'s owner — auto-redeploy skipped. Ask them to log in again.' });
    }

    // Respond right away — GitHub's webhook delivery has its own short timeout,
    // and a build can take minutes. The redeploy keeps running in the background;
    // progress shows up in the normal Live Logs / Deployment History UI.
    res.json({ success: true, message: 'Redeploy triggered' });
    runRedeploy(identity, deployment, { triggeredBy: 'webhook' }).catch((err) => {
        console.error(`[webhook] Redeploy failed for ${deployment.project_name}:`, err.message);
    });
});

async function loadOwnedWebDeployment(req, res) {
    const user = await getAuthenticatedUser(req);
    const [rows] = await pool.execute(
        'SELECT * FROM deployments WHERE id = ? AND github_user_id = ?',
        [req.params.id, user.id]
    );
    if (rows.length === 0) {
        res.status(404).json({ error: 'Deployment not found or access denied' });
        return null;
    }
    const deployment = rows[0];
    if (deployment.service_type !== 'web') {
        res.status(400).json({ error: 'Only Web deployments support this action' });
        return null;
    }
    if (!deployment.repository_name || !deployment.branch) {
        res.status(400).json({ error: 'This deployment predates redeploy support — delete and recreate it to enable it.' });
        return null;
    }
    return { user, deployment };
}

app.post('/deployments/:id/redeploy', deployLimiter, async (req, res) => {
    try {
        const loaded = await loadOwnedWebDeployment(req, res);
        if (!loaded) return;
        const result = await runRedeploy(loaded.user, loaded.deployment, { triggeredBy: 'manual' });
        res.json(result);
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        console.error(error);
        res.status(error.status || 500).json({ error: error.message || 'Redeploy failed' });
    }
});

app.post('/deployments/:id/rollback', deployLimiter, async (req, res) => {
    try {
        const loaded = await loadOwnedWebDeployment(req, res);
        if (!loaded) return;
        const { user, deployment } = loaded;

        const { buildId } = req.body;
        const [buildRows] = await pool.execute(
            'SELECT * FROM deployment_builds WHERE id = ? AND deployment_id = ?',
            [buildId, deployment.id]
        );
        if (buildRows.length === 0) {
            return res.status(404).json({ error: 'Build not found in this deployment\'s history' });
        }
        const build = buildRows[0];
        if (!build.commit_hash) {
            return res.status(400).json({ error: 'This build has no recorded commit to roll back to' });
        }

        const result = await runRedeploy(user, deployment, { commitOverride: build.commit_hash, triggeredBy: 'rollback' });
        res.json(result);
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        console.error(error);
        res.status(error.status || 500).json({ error: error.message || 'Rollback failed' });
    }
});

app.get('/deployments/:id/builds', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const [rows] = await pool.execute(
            'SELECT id FROM deployments WHERE id = ? AND github_user_id = ?',
            [req.params.id, user.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found or access denied' });
        }
        const [builds] = await pool.execute(
            'SELECT id, commit_hash, status, triggered_by, created_at FROM deployment_builds WHERE deployment_id = ? ORDER BY created_at DESC LIMIT 20',
            [req.params.id]
        );
        res.json(builds);
    } catch (error) {
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch build history' });
    }
});

app.post('/deployments/:id/stop', async (req, res) => {
    try {
        const deploymentId = req.params.id;
        const user = await getAuthenticatedUser(req);

        const [rows] = await pool.execute(
            'SELECT * FROM deployments WHERE id = ? AND github_user_id = ?',
            [deploymentId, user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found or access denied' });
        }

        const deployment = rows[0];

        try {
            await execFileAsync('docker', ['stop', deployment.container_name]);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to stop container' });
        }

        await pool.execute(`UPDATE deployments SET status = 'stopped' WHERE id = ?`, [deploymentId]);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/deployments/:id/restart', async (req, res) => {
    try {
        const deploymentId = req.params.id;
        const user = await getAuthenticatedUser(req);

        const [rows] = await pool.execute(
            'SELECT * FROM deployments WHERE id = ? AND github_user_id = ?',
            [deploymentId, user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found or access denied' });
        }

        const deployment = rows[0];

        if (deployment.status !== 'stopped') {
            return res.status(400).json({ error: 'Can only restart stopped deployments' });
        }

        try {
            await execFileAsync('docker', ['start', deployment.container_name]);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Failed to restart container' });
        }

        await pool.execute(`UPDATE deployments SET status = 'running' WHERE id = ?`, [deploymentId]);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.delete('/deployments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const user = await getAuthenticatedUser(req);

        const [rows] = await pool.execute(
            'SELECT * FROM deployments WHERE id = ? AND github_user_id = ?',
            [id, user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found or access denied' });
        }

        const deployment = rows[0];
        await removeDeploymentResources(deployment);

        await pool.execute('DELETE FROM deployments WHERE id = ?', [id]);

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        res.status(500).json({ error: 'Delete failed' });
    }
});

const PORT = 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
