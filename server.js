const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cors = require('cors');
const { exec } = require('child_process');
const mysql = require('mysql2/promise');
const path = require('path');

require('dotenv').config();

const fs = require('fs');

// Ensure directories that will be used for builds and APK artifacts
const APK_DIR = '/tmp/apks';
const APK_BUILD_DIR = '/tmp/apk-builds';
[APK_DIR, APK_BUILD_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log('Created directory:', dir);
    }
});

// === NEW: Modular deployment system (features-first approach) ===
const { deployProject } = require('./services/deploymentDispatcher');

const app = express();

// Trust Cloudflare (and other reverse proxies) so that req.secure and req.protocol work correctly
// This is critical when using Flexible SSL mode on Cloudflare
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// Serve built APKs statically
app.use('/apks', express.static('/tmp/apks'));

const deploymentLogs = {};

// Make deploymentLogs accessible for background log streamers (Cron, long-running Functions)
global.deploymentLogs = deploymentLogs;

// Persist deployment logs to DB so they survive backend restarts and deployment deletion
async function persistDeploymentLogs(projectName) {
    if (!projectName || !deploymentLogs[projectName]) return;

    try {
        const logsJson = JSON.stringify(deploymentLogs[projectName]);

        // Find the latest deployment id for this project (if exists)
        const [rows] = await pool.execute(
            `SELECT id FROM deployments 
             WHERE project_name = ? 
             ORDER BY created_at DESC 
             LIMIT 1`,
            [projectName]
        );

        const deploymentId = rows.length > 0 ? rows[0].id : null;

        await pool.execute(
            `INSERT INTO deployment_logs (deployment_id, project_name, logs, updated_at)
             VALUES (?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE 
                deployment_id = VALUES(deployment_id),
                logs = VALUES(logs),
                updated_at = NOW()`,
            [deploymentId, projectName, logsJson]
        );
    } catch (err) {
        console.error('Failed to persist deployment logs for', projectName, err.message);
    }
}

// Expose for background runtime log streamers in services/*Deployer (Function + Cron)
global.persistDeploymentLogs = persistDeploymentLogs;

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Preload persisted logs from DB at startup so runtime execution logs (e.g. previous [FUNCTION CALL]s)
// remain visible immediately after backend restart / page refresh, before any new tailer runs.
(async () => {
  try {
    const [rows] = await pool.execute(
      `SELECT project_name, logs FROM deployment_logs ORDER BY updated_at DESC`
    );
    let loaded = 0;
    for (const row of rows) {
      if (!row.project_name || !row.logs) continue;
      try {
        // Robust parse: column may be JSON (driver returns array) or TEXT (string) or Buffer
        let raw = row.logs;
        let parsed;
        if (Array.isArray(raw)) {
          parsed = raw;
        } else if (Buffer.isBuffer(raw)) {
          parsed = JSON.parse(raw.toString('utf8'));
        } else if (typeof raw === 'string') {
          parsed = JSON.parse(raw);
        } else {
          parsed = [];
        }
        if (Array.isArray(parsed)) {
          // Seed only if this process has not already started fresh logs for the project
          if (!deploymentLogs[row.project_name] || deploymentLogs[row.project_name].length === 0) {
            deploymentLogs[row.project_name] = parsed;
            loaded++;
          }
        }
      } catch (pe) {
        console.error('[logs] Bad persisted entry for', row.project_name, pe.message);
      }
    }
    if (loaded > 0) {
      console.log(`[logs] Preloaded ${loaded} project log history/histories (deployment + runtime) from DB for observability.`);
    }
  } catch (e) {
    console.error('[logs] Preload of deployment_logs failed:', e.message);
  }
})();

// Per-user isolation helper (Plan B) - now also validates against active sessions table
async function getAuthenticatedUser(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        const err = new Error('No authentication token');
        err.status = 401;
        throw err;
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
        const err = new Error('Invalid or expired token');
        err.status = 401;
        throw err;
    }

    // Critical: Check if this specific token_id is still active in DB
    // This enables cross-device logout (when one device logs out, it deletes all sessions)
    if (decoded.token_id) {
        const [rows] = await pool.execute(
            `SELECT 1 FROM user_sessions 
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
    }

    return decoded;
}

app.get('/', (req, res) => {

    res.send('Backend Server Running');
});

// Proper logout endpoint: invalidates ALL sessions for this user (cross-device logout)
app.post('/auth/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.json({ success: true }); // Already logged out
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.json({ success: true }); // Invalid token, treat as logged out
    }

    // Delete ALL active sessions for this user → other devices will be kicked out
    await pool.execute(
      'DELETE FROM user_sessions WHERE github_user_id = ?',
      [decoded.id]
    );

    res.json({ success: true, message: 'Logged out from all devices' });
  } catch (err) {
    console.error('Logout error:', err);
    res.json({ success: true }); // Fail safe
  }
});

// Also keep GET /auth/logout for convenience (GitHub session cleanup + redirect)
app.get('/auth/logout', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://hgu.app';
  const githubLogoutUrl = `https://github.com/logout?return_to=${encodeURIComponent(`${frontendUrl}/`)}`;
  res.redirect(githubLogoutUrl);
});

app.get('/auth/github', (req, res) => {

    // Request proper scopes so we can list the user's repositories (including private ones)
    const scopes = 'read:user,user:email,repo';

    // Support ?force=true to force showing the GitHub consent screen again
    // This is especially useful for Safari and when the user wants to re-authorize with new scopes
    const forceReauth = req.query.force === 'true';
    const prompt = forceReauth ? '&prompt=consent' : '';

    const redirectUri =
        'https://github.com/login/oauth/authorize'
        + `?client_id=${process.env.GITHUB_CLIENT_ID}`
        + `&scope=${scopes}`
        + prompt;

    res.redirect(redirectUri);
});

app.get('/auth/github/callback', async (req, res) => {

    const code = req.query.code;

    try {

        const tokenResponse = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code
            },
            {
                headers: {
                    Accept: 'application/json'
                }
            }
        );

        const accessToken =
            tokenResponse.data.access_token;

        const userResponse = await axios.get(
            'https://api.github.com/user',
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        const user = userResponse.data;
        const githubUserId = user.id;

        // Create a unique token ID for this session (enables proper multi-device logout)
        const tokenId = require('crypto').randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day

        // Store the active session in DB
        await pool.execute(
            `INSERT INTO user_sessions (github_user_id, token_id, expires_at) 
             VALUES (?, ?, ?)`,
            [githubUserId, tokenId, expiresAt]
        );

        const token = jwt.sign(
            {
                id: githubUserId,
                username: user.login,
                github_access_token: accessToken,
                token_id: tokenId   // Important for revocation
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '1d'
            }
        );

        // Always redirect to the frontend after successful GitHub OAuth
        const frontendUrl = process.env.FRONTEND_URL || 'https://hgu.app';
        res.redirect(`${frontendUrl}/dashboard?token=${token}`);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: 'GitHub OAuth Failed'
        });
    }
});

app.get('/repositories', async (req, res) => {

    try {

        const authHeader = req.headers.authorization;

        if (!authHeader) {

            return res.status(401).json({
                error: 'No token'
            });
        }

        const token = authHeader.split(' ')[1];

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const githubToken =
            decoded.github_access_token;

        const response = await axios.get(
            'https://api.github.com/user/repos',
            {
                headers: {
                    Authorization:
                        `Bearer ${githubToken}`
                }
            }
        );

        res.json(response.data);

    } catch (error) {

        console.error("Failed to fetch GitHub repositories:", error?.response?.data || error.message || error);

        // Return a proper error so the frontend can show the real reason to the user
        res.status(500).json({
            error: 'Failed to fetch repositories from GitHub',
            details: error?.response?.data?.message || error.message || 'Unknown error'
        });
    }
});

// Temporary compatibility endpoint (now user-scoped for Plan B isolation)
app.get('/projects', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const [rows] = await pool.execute(
            `SELECT * FROM deployments WHERE github_user_id = ? ORDER BY created_at DESC`,
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

app.post('/projects', async (req, res) => {
    const projectNameFromBody = req.body?.name;

    try {
        console.log('DEPLOY START');

        const {
            name,
            repository,
            branch,
            serviceType = 'web',
            // Web specific
            internalPort,
            buildCommand,
            startCommand,
            // Function / Cron - code source mode
            codeSource,           // 'repo' | 'inline'

            // Inline mode
            handlerCode,
            cronScript,
            cronSchedule,

            // Repo mode - file paths inside the repository
            handlerFilePath,
            cronFilePath
        } = req.body;

        const projectName = name;
        deploymentLogs[projectName] = [];
        const addLog = (message) => {
            console.log(message);
            deploymentLogs[projectName].push(message);
        };

        const decoded = await getAuthenticatedUser(req); // throws on missing/invalid (401)

        const githubToken = decoded.github_access_token;
        const githubUsername = decoded.username;
        const githubUserId = decoded.id; // GitHub numeric user ID for ownership

        addLog(`🚀 Deployment started (serviceType: ${serviceType}) for user #${githubUserId}`);

        // Use the new modular dispatcher
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
                buildCommand,
                startCommand,
                // Function / Cron
                codeSource,
                handlerCode,
                cronScript,
                cronSchedule,
                handlerFilePath,
                cronFilePath
            },
            {
                addLog,
                onComplete: () => {},
                onError: (err) => {
                    addLog(`❌ Error during deployment: ${err.message}`);
                }
            }
        );

        // Persist logs to DB so they survive restarts and even after the deployment record is deleted
        await persistDeploymentLogs(projectName);

        res.json(result);

    } catch (error) {
        console.error(error);

        // Even on early failure, try to persist whatever logs we have
        if (projectNameFromBody) {
            await persistDeploymentLogs(projectNameFromBody);
        }

        const status = error.status || 500;
        res.status(status).json({
            error: status === 401 ? 'Authentication required' : 'Deployment failed',
            message: error.message
        });
    }
});

app.get('/deployments', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const [rows] = await pool.execute(
            `SELECT * FROM deployments WHERE github_user_id = ? ORDER BY created_at DESC`,
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

// Get single deployment by ID (user-scoped for isolation)
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
    try {
        // Light auth (we don't have strong ownership for in-memory logs yet)
        await getAuthenticatedUser(req);
    } catch (e) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const projectName = req.params.name;

    // 1. Prefer in-memory (includes preloaded history + live runtime appends from docker logs tailers)
    let current = deploymentLogs[projectName];
    if (!current || current.length === 0) {
        // 2. Seed from persisted DB (survives restart; enables showing prior runtime logs + future appends)
        try {
            const [rows] = await pool.execute(
                `SELECT logs FROM deployment_logs WHERE project_name = ? LIMIT 1`,
                [projectName]
            );
            if (rows.length > 0) {
                // Robust parse supporting JSON column (array), TEXT (string) or Buffer
                let raw = rows[0].logs;
                let parsed;
                if (Array.isArray(raw)) {
                    parsed = raw;
                } else if (Buffer.isBuffer(raw)) {
                    parsed = JSON.parse(raw.toString('utf8'));
                } else if (typeof raw === 'string') {
                    parsed = JSON.parse(raw);
                } else {
                    parsed = [];
                }
                if (Array.isArray(parsed)) {
                    deploymentLogs[projectName] = parsed;
                    current = parsed;
                }
            }
        } catch (err) {
            console.error('Failed to load persisted logs for', projectName, err.message);
        }
    }

    const toReturn = current || [];

    // Snapshot to DB on every logs fetch. This guarantees that after you call the Function URL
    // and then Refresh Logs (or view later), the runtime [FUNCTION ...] lines are written to deployment_logs.
    persistDeploymentLogs(projectName).catch(() => {});

    res.json(toReturn);
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

            return res.status(404).json({
                error: 'Deployment not found or access denied'
            });
        }

        const deployment = rows[0];

        exec(
            `docker stop ${deployment.container_name}`,
            async (error) => {

                if (error) {

                    console.error(error);

                    return res.status(500).json({
                        error: 'Failed to stop container'
                    });
                }

                await pool.execute(
                    `
                    UPDATE deployments
                    SET status = 'stopped'
                    WHERE id = ?
                    `,
                    [deploymentId]
                );

                res.json({
                    success: true
                });
            }
        );

    } catch (error) {
        console.error(error);
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        res.status(500).json({
            error: 'Internal Server Error'
        });
    }
});

// Restart stopped container
app.post('/deployments/:id/restart', async (req, res) => {
    try {
        const deploymentId = req.params.id;
        const user = await getAuthenticatedUser(req);

        const [rows] = await pool.execute(
            'SELECT * FROM deployments WHERE id = ? AND github_user_id = ?',
            [deploymentId, user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: 'Deployment not found or access denied'
            });
        }

        const deployment = rows[0];

        // Only allow restart if currently stopped
        if (deployment.status !== 'stopped') {
            return res.status(400).json({
                error: 'Can only restart stopped deployments'
            });
        }

        exec(
            `docker start ${deployment.container_name}`,
            async (error) => {
                if (error) {
                    console.error(error);
                    return res.status(500).json({
                        error: 'Failed to restart container'
                    });
                }

                await pool.execute(
                    `
                    UPDATE deployments
                    SET status = 'running'
                    WHERE id = ?
                    `,
                    [deploymentId]
                );

                res.json({
                    success: true
                });
            }
        );

    } catch (error) {
        console.error(error);
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        res.status(500).json({
            error: 'Internal Server Error'
        });
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

            return res.status(404).json({
                error: 'Deployment not found or access denied'
            });
        }

        const deployment = rows[0];

        exec(`docker stop ${deployment.container_name}`);
        exec(`docker rm ${deployment.container_name}`);
        exec(`docker rmi ${deployment.image_name}`);

        // NPM Proxy Host cleanup (non-blocking, never fails the deletion)
        try {
            const { deleteProxyHost } = require('./services/NpmProxyManager');
            const addLog = (msg) => console.log(msg);
            await deleteProxyHost({
                projectName: deployment.project_name,
                addLog
            });
        } catch (npmErr) {
            console.error('NPM Proxy Host cleanup error (non-fatal):', npmErr.message);
        }

        await pool.execute(
            'DELETE FROM deployments WHERE id = ?',
            [id]
        );

        res.json({
            success: true
        });

    } catch (error) {
        console.error(error);
        if (error.status === 401) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        res.status(500).json({
            error: 'Delete failed'
        });
    }
});

const PORT = 3000;

app.listen(PORT, () => {

    console.log(`Server running on port ${PORT}`);
});

