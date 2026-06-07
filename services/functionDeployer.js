/**
 * Serverless Function Deployer
 * 
 * Lightweight real implementation for demo:
 * - Runs a small Node HTTP server in a container
 * - Returns a callable endpoint that responds with JSON
 */
const { createProxyHost } = require('./NpmProxyManager');

async function deploy(params, { addLog }) {
    const { 
        name: projectName, 
        repository, 
        branch,
        githubToken,
        githubUsername,
        pool, 
        githubUserId = null,
        codeSource = 'repo',
        handlerCode,
        handlerFilePath
    } = params;

    addLog('⚡ Function deployment');

    const deploymentId = Date.now();
    const containerName = `function-${deploymentId}`;
    const imageName = `function-${deploymentId}`;

    // Allocate port (reuse simple max port logic)
    const [rows] = await pool.execute('SELECT MAX(port) as maxPort FROM deployments');
    const externalPort = rows[0].maxPort ? rows[0].maxPort + 1 : 3010;

    // Use the same host resolution as Web deployments so the URL is accessible from outside
    const serverHost = process.env.SERVER_HOST || process.env.HOSTNAME || 'localhost';
    const endpoint = `http://${serverHost}:${externalPort}`;

    addLog(`🔨 Starting Function container on port ${externalPort}...`);

    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    let containerStarted = false;

    try {
        const fs = require('fs');
        const path = require('path');

        let finalHandlerCode = '';

        const isInline = codeSource === 'inline' || (handlerCode && handlerCode.trim());

        if (isInline) {
            // Quick Test mode
            finalHandlerCode = handlerCode && handlerCode.trim()
                ? handlerCode
                : `module.exports = async (req) => ({
                    message: "Hello from Quick Test Function!",
                    project: "${projectName}",
                    time: new Date().toISOString()
                  });`;
            addLog('📝 Using inline code (Quick Test mode)');
        } else {
            // Repo mode - clone and auto-detect handler file
            const projectPath = `/tmp/deployments/${projectName}-${deploymentId}`;

            addLog(`📦 Cloning repository to read function code...`);
            const cloneCommand = `git clone --branch ${branch} https://${githubToken}@github.com/${githubUsername}/${repository}.git ${projectPath}`;
            await execAsync(cloneCommand, { timeout: 120000 });

            // Auto-detection candidates (user-provided path has highest priority)
            const candidates = [
                handlerFilePath,                    // user input (if any)
                'function/handler.js',
                'handler.js',
                'src/handler.js',
                'function.js',
                'src/function.js',
                'index.js',
                'src/index.js'
            ].filter(Boolean);

            let foundPath = null;
            for (const candidate of candidates) {
                const fullPath = path.join(projectPath, candidate);
                if (fs.existsSync(fullPath)) {
                    foundPath = candidate;
                    break;
                }
            }

            if (!foundPath) {
                addLog(`❌ Could not find any handler file in the repository.`);
                addLog(`   Tried the following paths: ${candidates.join(', ')}`);
                throw new Error(`No handler file found in repository. Tried: ${candidates.join(', ')}`);
            }

            const fullFilePath = path.join(projectPath, foundPath);
            finalHandlerCode = fs.readFileSync(fullFilePath, 'utf8');
            addLog(`✅ Loaded handler from repository: ${foundPath}`);
        }

        const userHandler = finalHandlerCode;

        // Robust file-based injection (docker cp) — no heredoc/template literal quoting in source
        // Guarantees backend can start (no SyntaxError) and delivers clear runtime logs for demo (Priority 1)
        const tmpDir = '/tmp/function-deploys';
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const handlerTmp = path.join(tmpDir, `handler-${deploymentId}.js`);
        const wrapperTmp = path.join(tmpDir, `server-${deploymentId}.js`);

        fs.writeFileSync(handlerTmp, finalHandlerCode, 'utf8');

        const wrapperCode = `const http = require("http");
const handler = require("/app/handler.js");

const server = http.createServer(async (req, res) => {
  const timestamp = new Date().toISOString();
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const path = req.url || '/';

  console.log(\`[FUNCTION CALL] \${timestamp} \${req.method} \${path} \${clientIp}\`);

  try {
    console.log(\`[FUNCTION EXECUTION] handler invoked\`);
    const result = await handler(req);
    console.log(\`[FUNCTION SUCCESS] response returned\`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (e) {
    console.error(\`[FUNCTION ERROR] \${e.message}\`);
    if (e.stack) console.error(e.stack);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(3000, () => {
  console.log("Function handler ready on port 3000");
  console.log("[FUNCTION] Listening for requests...");
});
`;
        fs.writeFileSync(wrapperTmp, wrapperCode, 'utf8');

        addLog('📦 Starting Function container (robust docker cp, no quoting issues)...');

        // Dormant container + port publish
        await execAsync(`docker run -d -p ${externalPort}:3000 --name ${containerName} node:18-alpine tail -f /dev/null`);
        containerStarted = true;

        // Ensure /app directory exists before copying files (fixes "Could not find the file /app" error)
        await execAsync(`docker exec ${containerName} mkdir -p /app`);

        // Exact file copy (handler + logging wrapper)
        await execAsync(`docker cp ${handlerTmp} ${containerName}:/app/handler.js`);
        await execAsync(`docker cp ${wrapperTmp} ${containerName}:/app/server.js`);

        // Start server, logs visible via docker logs
        await execAsync(`docker exec -d ${containerName} sh -c 'cd /app && exec node server.js >> /proc/1/fd/1 2>> /proc/1/fd/2'`);

        // Cleanup temps
        try { fs.unlinkSync(handlerTmp); fs.unlinkSync(wrapperTmp); } catch (_) {}

        // Give it a moment and verify the container actually stayed alive
        await new Promise(r => setTimeout(r, 1500));
        const { stdout: psOut } = await execAsync(`docker ps --filter "name=${containerName}" --format "{{.Status}}"`);
        
        let finalUrl = endpoint;
        if (psOut.includes('Up')) {
          // Call createProxyHost() AFTER container is confirmed running (exactly like webDeployer post-health).
          // On success: finalUrl becomes https://<slug>.hgu.app (when AUTO_SSL_ENABLED + cert succeeds).
          try {
            const proxyResult = await createProxyHost({
              projectName,
              forwardPort: externalPort,
              addLog
            });
            if (proxyResult.success && proxyResult.url) {
              finalUrl = proxyResult.url;
            } else if (proxyResult.error) {
              addLog(`⚠️ [NPM] Proxy Host creation failed: ${proxyResult.error}. Using port URL.`);
            }
          } catch (proxyErr) {
            addLog(`⚠️ [NPM] Unexpected error creating Proxy Host (deployment continues): ${proxyErr.message}`);
          }

          addLog(`✅ Function running at ${finalUrl}`);
        } else {
          const { stdout: logs } = await execAsync(`docker logs ${containerName} 2>&1 | tail -30`);
          addLog(`❌ Function container exited quickly. Last logs:`);
          logs.trim().split('\n').forEach(l => addLog(`   ${l}`));
          throw new Error('Function container failed to stay running');
        }

        // Background log streaming for runtime Function execution observability.
        // Every HTTP request will produce [FUNCTION CALL], [FUNCTION EXECUTION], [FUNCTION SUCCESS/ERROR] lines.
        // These are pushed into the shared deploymentLogs (visible in existing Logs UI) and persisted to DB.
        const { spawn } = require('child_process');
        const logTail = spawn('docker', ['logs', '-f', '--tail', '0', containerName], { stdio: ['ignore', 'pipe', 'pipe'] });

        const pushLog = (line) => {
            if (!line || !line.trim()) return;
            if (!global.deploymentLogs[projectName]) global.deploymentLogs[projectName] = [];
            global.deploymentLogs[projectName].push(line.trim());
            if (global.deploymentLogs[projectName].length > 300) global.deploymentLogs[projectName].shift();
            // Persist immediately so runtime logs survive refresh + backend restart (critical for demo)
            if (global.persistDeploymentLogs) {
                global.persistDeploymentLogs(projectName).catch(() => {});
            } else if (pool) {
                // Direct fallback persist (keeps deployment_id lookup behavior)
                const logsJson = JSON.stringify(global.deploymentLogs[projectName] || []);
                pool.execute(
                    `INSERT INTO deployment_logs (deployment_id, project_name, logs, updated_at)
                     VALUES ((SELECT id FROM deployments WHERE project_name = ? ORDER BY created_at DESC LIMIT 1), ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE logs = VALUES(logs), updated_at = NOW()`,
                    [projectName, projectName, logsJson]
                ).catch(() => {});
            }
        };

        logTail.stdout.on('data', (data) => data.toString().trim().split('\n').forEach(pushLog));
        logTail.stderr.on('data', (data) => data.toString().trim().split('\n').forEach(pushLog));

        const { safeInsertDeployment } = require('../utils/dbHelpers');

        await safeInsertDeployment(pool, {
            projectName,
            repository: repository || null,
            containerName,
            imageName,
            port: externalPort,
            url: finalUrl,
            status: 'running',
            serviceType: 'function',
            githubUserId: githubUserId || null
        });

        return {
            success: true,
            serviceType: 'function',
            endpoint,
            url: finalUrl,
            message: 'Function is live and callable.'
        };
    } catch (err) {
        // Clean up the container if it was started but later steps failed.
        // This releases the port even if we keep the failed record in DB.
        if (containerStarted && containerName) {
            try {
                addLog('🧹 Cleaning up failed Function container (port will be released)...');
                await execAsync(`docker stop ${containerName} || true`);
                await execAsync(`docker rm ${containerName} || true`);
            } catch (cleanupErr) {
                addLog(`⚠️ Container cleanup warning: ${cleanupErr.message}`);
            }
        }

        addLog(`❌ Function deployment failed: ${err.message}`);
        throw err;
    }
}

module.exports = {
    deploy
};
