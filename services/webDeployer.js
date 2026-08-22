const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const path = require('path');
const fs = require('fs');
const { safeInsertDeployment } = require('../utils/dbHelpers');
const { createProxyHost } = require('./NpmProxyManager');
const { cloneRepo } = require('../utils/gitClone');
const { allocatePort } = require('../utils/allocatePort');

// New auto-detection modules (for Dockerfile-less Web deployments)
let detectProjectType, ensureDockerfile;

try {
  ({ detectProjectType } = require('./web/projectDetector'));
  ({ ensureDockerfile } = require('./web/generateDockerfile'));
} catch (e) {
  console.warn('⚠️ Auto-Dockerfile detection modules not found. Web auto-detection disabled.');
  detectProjectType = () => ({ type: 'unknown', framework: null });
  ensureDockerfile = () => null;
}

const MEM_LIMIT = process.env.DEPLOY_MEM_LIMIT || '512m';
const CPU_LIMIT = process.env.DEPLOY_CPU_LIMIT || '1';

// Internal container port each auto-generated template's CMD actually listens on.
// Anything not listed here (e.g. static/nginx-based templates) defaults to 80.
const DEFAULT_INTERNAL_PORT = {
    nextjs: 3000,
    'node-generic': 3000,
    'node-backend': 3000,
    'python-django': 8000,
    'python-fastapi': 8000,
    'python-generic': 8000,
    'python-flask': 5000,
    'java-maven': 8080,
    'java-gradle': 8080,
    go: 8080
};
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function cleanupProjectDir(projectPath, addLog) {
    if (!projectPath) return;
    try {
        await fs.promises.rm(projectPath, { recursive: true, force: true });
    } catch (e) {
        if (addLog) addLog(`⚠️ Could not clean up build directory: ${e.message}`);
    }
}

/**
 * Web Service Deployer — Web is the primary/highest-priority service type.
 */
async function deploy(params, { addLog }) {
    const {
        name: projectName,
        repository,
        branch,
        githubToken,
        githubUsername,
        pool,
        envVars = {},
        githubUserId = null
    } = params;

    let internalPort = params.internalPort || 80;

    const deploymentId = Date.now();
    const projectPath = `/tmp/deployments/${projectName}-${deploymentId}`;
    const imageName = `web-${deploymentId}`;
    const containerName = `web-${deploymentId}`;

    let failureStage = null;
    let commitHash = null;
    let containerStarted = false;

    const externalPort = await allocatePort(pool);

    const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || 'hgu.app';
    const idealUrl = `https://${projectName}.${PUBLIC_DOMAIN}`;

    const serverHost = process.env.SERVER_HOST || process.env.HOSTNAME || 'localhost';
    const practicalUrl = `http://${serverHost}:${externalPort}`;

    const url = (PUBLIC_DOMAIN && PUBLIC_DOMAIN !== 'hgu.app') ? idealUrl : practicalUrl;

    addLog(`📦 [1/6] Cloning repository (branch: ${branch})...`);

    try {
        await cloneRepo({ githubUsername, repository, branch, githubToken, destPath: projectPath });
        addLog('✅ [1/6] Repository cloned successfully');

        // === Smart Dockerfile handling (support repos without a Dockerfile) ===
        let dockerfilePath = null;

        try {
            const contents = fs.readdirSync(projectPath);

            if (contents.includes('Dockerfile')) {
                addLog('✅ Dockerfile found in repository root.');
                dockerfilePath = path.join(projectPath, 'Dockerfile');
            } else {
                addLog('🔍 Dockerfile not found. Attempting to auto-detect project type...');

                const detection = detectProjectType(projectPath);

                if (detection.type === 'nextjs') {
                    addLog(`   Detected as Next.js project.`);
                } else {
                    addLog(`   Detected project type: ${detection.type} (${detection.framework || 'unknown'})`);
                }

                const generatedDockerfile = ensureDockerfile(projectPath, detection);

                if (generatedDockerfile) {
                    if (detection.type === 'nextjs') {
                        addLog(`✅ Detected as Next.js project.`);
                        addLog(`   Auto-generated Dockerfile will be used for deployment.`);
                        addLog(`   (Note: If next.config.js does not have output: 'standalone', the image may be larger.)`);
                    } else {
                        addLog(`✅ Auto-generated Dockerfile for ${detection.type}.`);
                        addLog('   This project will be built without a Dockerfile in your repository.');
                    }
                    if (detection.type === 'python-flask') {
                        addLog("   Note: make sure app.run() uses host='0.0.0.0' — 127.0.0.1 is not reachable from outside the container.");
                    }
                    dockerfilePath = generatedDockerfile;

                    if (!params.internalPort) {
                        internalPort = DEFAULT_INTERNAL_PORT[detection.type] || 80;
                    }
                } else {
                    addLog('❌ [Final] Deployment Failed: Could not auto-detect project type.');
                    addLog('   Please add a Dockerfile to your repository root, or use a supported framework');
                    addLog('   (Next.js / Vite React / Node / Python / Java / Go).');
                    failureStage = 'validation_failed';
                    throw new Error('No Dockerfile found and could not auto-generate one for this project type.');
                }
            }
        } catch (e) {
            if (!failureStage) failureStage = 'validation_failed';
            throw e;
        }

        // Commit hash (traceability)
        try {
            const { stdout } = await execFileAsync('git', ['-C', projectPath, 'rev-parse', 'HEAD']);
            commitHash = stdout.trim().substring(0, 12);
            addLog(`📌 Commit: ${commitHash}`);
        } catch (e) {
            addLog('⚠️ Could not get commit hash');
        }

        // Build
        addLog('🔨 [2/6] Building Docker image...');

        const buildArgs = dockerfilePath
            ? ['build', '-t', imageName, '-f', dockerfilePath, projectPath]
            : ['build', '-t', imageName, projectPath];

        try {
            await execFileAsync('docker', buildArgs, { timeout: 1000 * 60 * 10 }); // 10 min
            addLog('✅ [2/6] Docker image built successfully');
        } catch (buildErr) {
            failureStage = 'build_failed';
            addLog(`❌ [2/6] Docker build failed`);

            const fullOutput = (buildErr.stdout || '') + (buildErr.stderr || '');
            if (fullOutput) {
                fullOutput.toString().trim().split('\n').forEach(line => {
                    if (line.trim()) addLog(`   ${line}`);
                });
            } else {
                addLog(`   ${buildErr.message || 'No additional output captured'}`);
            }

            throw buildErr;
        }

        // Run container
        addLog(`🐳 [3/6] Starting container (internal port ${internalPort} → external ${externalPort})...`);
        addLog(`🌐 Service is now accessible at: ${practicalUrl}`);

        const envArgs = [];
        for (const [key, value] of Object.entries(envVars || {})) {
            if (!ENV_KEY_RE.test(key)) {
                addLog(`⚠️ Skipping invalid environment variable name: ${key}`);
                continue;
            }
            envArgs.push('-e', `${key}=${value}`);
        }

        const runArgs = [
            'run', '-d',
            '--name', containerName,
            '--memory', MEM_LIMIT,
            '--cpus', CPU_LIMIT,
            '-p', `${externalPort}:${internalPort}`,
            ...envArgs,
            imageName
        ];

        try {
            await execFileAsync('docker', runArgs);
            addLog('✅ [3/6] Container started');
            containerStarted = true;
        } catch (runErr) {
            failureStage = 'container_start_failed';
            addLog(`❌ [3/6] Failed to start container`);
            throw runErr;
        }

        // Health check (give it 3 seconds), and actually gate success on it.
        addLog('🩺 [4/6] Running basic health check...');
        await new Promise(r => setTimeout(r, 3000));

        let healthStatus = 'unknown';
        try {
            const { stdout } = await execFileAsync('docker', ['inspect', '--format={{.State.Health.Status}}', containerName]);
            healthStatus = stdout.trim() || 'no-healthcheck';
        } catch (e) {
            healthStatus = 'no-healthcheck';
        }
        addLog(`🩺 Health status: ${healthStatus}`);

        // A container with no HEALTHCHECK defined reports "no-healthcheck" / "<no value>" — that's fine
        // (most student projects don't define one). Only a container that is actually unhealthy or has
        // already exited should fail the deployment.
        let isRunning = false;
        try {
            const { stdout: psOut } = await execFileAsync('docker', ['ps', '--filter', `name=${containerName}`, '--format', '{{.Status}}']);
            isRunning = psOut.includes('Up');
        } catch (e) {
            isRunning = false;
        }

        if (healthStatus === 'unhealthy' || !isRunning) {
            failureStage = 'health_check_failed';
            addLog(`❌ [4/6] Container is not healthy (status: ${healthStatus}, running: ${isRunning})`);
            let crashLogs = '';
            try {
                const { stdout } = await execFileAsync('docker', ['logs', '--tail', '30', containerName]);
                crashLogs = stdout;
            } catch (_) {}
            if (crashLogs) crashLogs.trim().split('\n').forEach(l => addLog(`   ${l}`));
            throw new Error(`Container failed health check (status: ${healthStatus})`);
        }

        // Proxy Host (only after the container is confirmed healthy/running)
        let finalUrl = url;
        try {
            const proxyResult = await createProxyHost({ projectName, forwardPort: externalPort, addLog });
            if (proxyResult.success && proxyResult.url) {
                finalUrl = proxyResult.url;
            } else if (proxyResult.error) {
                addLog(`⚠️ [NPM] Proxy Host creation failed: ${proxyResult.error}. Using port URL.`);
            }
        } catch (proxyErr) {
            addLog(`⚠️ [NPM] Unexpected error creating Proxy Host (deployment continues): ${proxyErr.message}`);
        }

        await safeInsertDeployment(pool, {
            projectName,
            repository,
            containerName,
            imageName,
            port: externalPort,
            url: finalUrl,
            status: 'running',
            serviceType: 'web',
            envVars: Object.keys(envVars || {}).length > 0 ? envVars : null,
            githubUserId
        });

        addLog('✅ [5/6] Deployment recorded in database');

        if (dockerfilePath && dockerfilePath.includes('templates')) {
            addLog('ℹ️  Note: This deployment used an auto-generated Dockerfile (no Dockerfile was found in your repo).');
        }

        addLog('✅ [6/6] Web service is now live');
        addLog(`🌐 Final access URL: ${finalUrl}`);
        if (!PUBLIC_DOMAIN || PUBLIC_DOMAIN === 'hgu.app') {
            addLog('   (Subdomain may not work in lab environments without DNS setup — use the port URL above.)');
        }

        await cleanupProjectDir(projectPath, addLog);

        return {
            success: true,
            url: finalUrl,
            serviceType: 'web',
            externalPort,
            internalPort,
            commitHash,
            healthStatus,
            deploymentId,
            failureStage: null
        };

    } catch (error) {
        if (containerStarted && containerName) {
            try {
                addLog('🧹 Cleaning up failed Web container (port will be released)...');
                await execFileAsync('docker', ['stop', containerName]).catch(() => {});
                await execFileAsync('docker', ['rm', containerName]).catch(() => {});
            } catch (cleanupErr) {
                addLog(`⚠️ Container cleanup warning: ${cleanupErr.message}`);
            }
        }

        addLog(`❌ Web deployment failed at stage: ${failureStage || 'unknown'}`);
        addLog(`Error: ${error.message}`);
        addLog(`❌ [Final] Deployment Failed at stage: ${failureStage || 'unknown'}. ${error.message}`);

        try {
            await safeInsertDeployment(pool, {
                projectName,
                repository,
                containerName: containerName || `failed-${deploymentId}`,
                imageName: imageName || `failed-${deploymentId}`,
                port: null,
                url: 'Deployment failed',
                status: 'failed',
                serviceType: 'web',
                githubUserId
            });
        } catch (dbErr) {
            console.error('Failed to record failure in DB:', dbErr.message);
        }

        await cleanupProjectDir(projectPath, addLog);

        const enhancedError = new Error(error.message);
        enhancedError.failureStage = failureStage || 'unknown';
        enhancedError.stage = failureStage;
        throw enhancedError;
    }
}

module.exports = {
    deploy
};
