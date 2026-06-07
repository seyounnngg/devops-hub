/**
 * Cron Job Deployer
 * 
 * Lightweight real-ish implementation for demo:
 * - Runs a container that executes on a schedule (every 30s for demo visibility)
 * - Logs each execution so you can see it in real-time logs
 */
async function register(params, { addLog }) {
    const { 
        name: projectName, 
        repository, 
        branch,
        githubToken,
        githubUsername,
        pool, 
        githubUserId = null,
        codeSource = 'repo',
        cronScript,
        cronSchedule,
        cronFilePath
    } = params;

    addLog('⏰ Cron Job deployment');

    const deploymentId = Date.now();
    const containerName = `cron-${deploymentId}`;

    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const schedule = cronSchedule || '*/10 * * * * *'; // default every 10s for easy demo/testing (user can override)
    const script = (cronScript && cronScript.trim()) 
        ? cronScript 
        : `echo "[Cron] ${projectName} executed at $(date -Iseconds)"`;

    try {
        const fs = require('fs');
        const path = require('path');

        let finalScript = '';
        const isInline = codeSource === 'inline' || (cronScript && cronScript.trim());

        let foundPath = null;
        let isNodeScript = false;
        let projectPath = null;
        let fullFilePath = null;

        if (isInline) {
            finalScript = cronScript && cronScript.trim() ? cronScript : `echo "[Cron] Quick Test execution for ${projectName} at $(date)"`;
            addLog('📝 Using inline script (Quick Test mode)');
            isNodeScript = false; // treat pasted script as shell by default for safety
        } else {
            // Repo mode - clone and auto-detect cron script
            projectPath = `/tmp/deployments/${projectName}-${deploymentId}`;

            addLog(`📦 Cloning repository to read cron script...`);
            const cloneCommand = `git clone --branch ${branch} https://${githubToken}@github.com/${githubUsername}/${repository}.git ${projectPath}`;
            await execAsync(cloneCommand, { timeout: 120000 });

            // Auto-detection candidates (user-provided path has highest priority)
            const candidates = [
                cronFilePath,
                'cron.sh',
                'job.sh',
                'cron/job.sh',
                'src/cron.sh',
                'scripts/cron.sh',
                'cron.js',
                'job.js',
                'src/cron.js',
                'scripts/cron.js'
            ].filter(Boolean);

            for (const candidate of candidates) {
                const fullPath = path.join(projectPath, candidate);
                if (fs.existsSync(fullPath)) {
                    foundPath = candidate;
                    break;
                }
            }

            if (!foundPath) {
                addLog(`❌ Could not find any cron script file in the repository.`);
                addLog(`   Tried the following paths: ${candidates.join(', ')}`);
                addLog(`   → Put cron.js (or cron.sh) in the repository root.`);
                throw new Error(`No cron script file found in repository. Tried: ${candidates.join(', ')}`);
            }

            fullFilePath = path.join(projectPath, foundPath);
            finalScript = fs.readFileSync(fullFilePath, 'utf8');
            addLog(`✅ Loaded cron script from repository: ${foundPath}`);

            isNodeScript = foundPath.endsWith('.js');
        }

        // Robust container startup using docker cp (exact file, no quoting hell)
        // + clean scheduler that actually runs the user's real cron.js / cron.sh on schedule
        addLog(`🚀 Starting cron container and copying job file...`);

        // Start a keep-alive container
        await execAsync(`docker run -d --name ${containerName} node:18-alpine tail -f /dev/null`);

        const workDir = '/app';
        await execAsync(`docker exec ${containerName} mkdir -p ${workDir}`);

        let jobCmd;
        let jobFileInside = `${workDir}/job`;

        if (isInline) {
            // Inline: write content directly via exec (small payload)
            jobFileInside = isNodeScript ? `${workDir}/job.js` : `${workDir}/job.sh`;
            const inlineContent = finalScript.replace(/'/g, "'\\''");
            await execAsync(`docker exec ${containerName} sh -c "cat > ${jobFileInside} << 'INLINEJOBEOF'
${finalScript}
INLINEJOBEOF"`);
            jobCmd = isNodeScript ? `node ${jobFileInside}` : `sh ${jobFileInside}`;
            addLog('📝 Inline job file written');
        } else {
            // Repo mode: use docker cp for the exact original file (zero escaping problems)
            const fullFilePath = path.join(projectPath, foundPath);
            jobFileInside = isNodeScript ? `${workDir}/job.js` : `${workDir}/job.sh`;
            await execAsync(`docker cp ${fullFilePath} ${containerName}:${jobFileInside}`);

            // If the repo also had a package.json next to it or in root, copy it too
            const pkgCandidates = [
                path.join(path.dirname(fullFilePath), 'package.json'),
                path.join(projectPath, 'package.json')
            ];
            for (const p of pkgCandidates) {
                if (fs.existsSync(p)) {
                    await execAsync(`docker cp ${p} ${containerName}:${workDir}/package.json`);
                    addLog('📦 package.json copied from repository');
                    break;
                }
            }

            jobCmd = isNodeScript ? `node ${jobFileInside}` : `sh ${jobFileInside}`;
            addLog(`✅ Job file copied: ${foundPath} → ${jobFileInside}`);
        }

        // Install: ALWAYS install node-cron (our scheduler needs it) + user's deps if package.json present
        const installCmd = `docker exec ${containerName} sh -c '
            cd ${workDir}
            npm init -y > /dev/null 2>&1 || true
            npm install node-cron --save 2>&1 | tail -3
            if [ -f package.json ]; then
                npm install --prefer-offline 2>&1 | tail -5
            fi
        '`;
        await execAsync(installCmd, { timeout: 120000 });

        // Write a small, clean, reliable scheduler (no user code embedded here)
        const scheduler = `const cron = require("node-cron");
const { execSync } = require("child_process");

const schedule = "${schedule}";
const cmd = "${jobCmd}";

console.log("Cron scheduler started with schedule: " + schedule);

cron.schedule(schedule, () => {
  console.log("[Cron] Executing scheduled task...");
  try {
    const output = execSync(cmd, {
      encoding: "utf8",
      cwd: "${workDir}",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (output && output.trim()) {
      output.trim().split("\\n").forEach(line => console.log(line));
    }
  } catch (e) {
    console.error("[Cron Error]", e.message || String(e));
  }
  console.log("[Cron] Task completed at", new Date().toISOString());
});

console.log("Ready. Waiting for schedule ticks...");
`;

        await execAsync(`docker exec ${containerName} sh -c 'cat > /app/scheduler.js << "SCHEDULEREOL"
${scheduler}
SCHEDULEREOL
'`);

        // Start scheduler with output redirected to container's main log stream
        // (so docker logs + the frontend live log tailer can see the executions)
        await execAsync(`docker exec -d ${containerName} sh -c 'cd /app && exec node /app/scheduler.js >> /proc/1/fd/1 2>> /proc/1/fd/2'`);

        addLog(`✅ Cron container started with schedule: ${schedule}`);

        // Stronger health check: container Up + scheduler actually printed "Ready"
        await new Promise(r => setTimeout(r, 2500));
        const { stdout: psCheck } = await execAsync(`docker ps --filter "name=${containerName}" --format "{{.Status}}"`);
        const { stdout: readyCheck } = await execAsync(`docker logs ${containerName} 2>&1 | grep -c "Ready. Waiting" || true`);
        
        if (psCheck.includes('Up') && parseInt(readyCheck.trim() || '0') > 0) {
          addLog(`✅ Script will run according to the schedule. Watch logs for executions.`);
        } else {
          const { stdout: crashLogs } = await execAsync(`docker logs ${containerName} 2>&1 | tail -40`);
          addLog(`❌ Cron container crashed shortly after start. Last logs:`);
          crashLogs.trim().split('\n').forEach(l => addLog(`   ${l}`));
          const { safeInsertDeployment } = require('../utils/dbHelpers');
          await safeInsertDeployment(pool, {
              projectName,
              repository,
              containerName,
              imageName: null,
              port: null,
              url: `Schedule: ${schedule}`,
              status: 'failed',
              serviceType: 'cron',
              githubUserId
          });
          throw new Error('Cron container failed to stay running');
        }

        // Background log streaming
        const { spawn } = require('child_process');
        const logTail = spawn('docker', ['logs', '-f', '--tail', '0', containerName], { stdio: ['ignore', 'pipe', 'pipe'] });

        const pushLog = (line) => {
            if (!line || !line.trim()) return;
            if (!global.deploymentLogs[projectName]) global.deploymentLogs[projectName] = [];
            global.deploymentLogs[projectName].push(line.trim());
            if (global.deploymentLogs[projectName].length > 300) global.deploymentLogs[projectName].shift();
        };

        logTail.stdout.on('data', (data) => data.toString().trim().split('\n').forEach(pushLog));
        logTail.stderr.on('data', (data) => data.toString().trim().split('\n').forEach(pushLog));

        const { safeInsertDeployment } = require('../utils/dbHelpers');

        await safeInsertDeployment(pool, {
            projectName,
            repository,
            containerName,
            imageName: null,
            port: null,
            url: `Schedule: ${schedule}`,
            status: 'running',
            serviceType: 'cron',
            githubUserId
        });

        return {
            success: true,
            serviceType: 'cron',
            schedule,
            message: `Cron is active. Executions will appear in logs according to schedule.`
        };
    } catch (err) {
        addLog(`❌ Cron deployment failed: ${err.message}`);
        throw err;
    }
}

module.exports = {
    register
};
