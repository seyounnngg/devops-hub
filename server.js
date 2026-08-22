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

const { assertSafeProjectName, assertSafeRepository, assertSafeBranch } = require('./utils/validate');

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
app.use(express.json());
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

// Preload persisted logs from DB at startup (per-user keyed, see utils/add_github_user_id_to_deployment_logs.js)
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

app.get('/repositories', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);

        const response = await axios.get('https://api.github.com/user/repos', {
            headers: { Authorization: `Bearer ${user.github_access_token}` }
        });

        res.json(response.data);
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
