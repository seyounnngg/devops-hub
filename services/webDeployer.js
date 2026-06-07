const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const { safeInsertDeployment } = require('../utils/dbHelpers');

// New auto-detection modules (for Dockerfile-less Web deployments)
// Wrapped in try/catch so the backend doesn't crash on startup if the files are missing
let detectProjectType, ensureDockerfile;

try {
  ({ detectProjectType } = require('./web/projectDetector'));
  ({ ensureDockerfile } = require('./web/generateDockerfile'));
} catch (e) {
  console.warn('⚠️ Auto-Dockerfile detection modules not found. Web auto-detection disabled.');
  detectProjectType = () => ({ type: 'unknown', framework: null });
  ensureDockerfile = () => null;
}

/**
 * Web Service Deployer - MAIN FOCUS
 * 
 * Goal: Make this as close as possible to RS-02 and UC-03 in the Requirement Engineering doc.
 * 
 * Improvements in this version:
 * - Supports custom internal port (very important)
 * - Records commit hash
 * - Clear failure stage reporting
 * - Basic health check after container starts
 * - Better structured stages
 * - Accepts buildCommand / startCommand (prepared for future frontend)
 */
async function deploy(params, { addLog }) {
    const {
        name: projectName,
        repository,
        branch,
        githubToken,
        githubUsername,
        pool,
        // internalPort handled separately below to allow reassignment after detection
        buildCommand,
        startCommand,
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

    // Allocate external port (simple MAX+1 for now)
    const [rows] = await pool.execute('SELECT MAX(port) as maxPort FROM deployments');
    const externalPort = rows[0].maxPort ? rows[0].maxPort + 1 : 3010;

    // Calculate access URLs early (needed for logs after container start)
    const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || 'hgu.app';
    const idealUrl = `https://${projectName}.${PUBLIC_DOMAIN}`;

    const serverHost = process.env.SERVER_HOST || process.env.HOSTNAME || 'localhost';
    const practicalUrl = `http://${serverHost}:${externalPort}`;

    // Prefer subdomain only if a proper domain is configured; otherwise use practical port-based URL
    const url = (PUBLIC_DOMAIN && PUBLIC_DOMAIN !== 'hgu.app') ? idealUrl : practicalUrl;

    addLog(`📦 [1/6] Cloning repository (branch: ${branch})...`);

    const cloneCommand = `git clone --branch ${branch} https://${githubToken}@github.com/${githubUsername}/${repository}.git ${projectPath}`;

    try {
        await execAsync(cloneCommand, { timeout: 120000 });
        addLog('✅ [1/6] Repository cloned successfully');

        // === Smart Dockerfile handling (support repos without a Dockerfile) ===
        let dockerfilePath = null;

        try {
            const fs = require('fs');
            const contents = fs.readdirSync(projectPath);

            if (contents.includes('Dockerfile')) {
                addLog('✅ Dockerfile found in repository root.');
                dockerfilePath = path.join(projectPath, 'Dockerfile');
            } else if (buildCommand && buildCommand.includes('Dockerfile')) {
                // User is providing custom build command that handles Dockerfile
                addLog('📝 Custom buildCommand provided. Using it as-is.');
            } else {
                // Attempt auto-detection and Dockerfile generation
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
                    dockerfilePath = generatedDockerfile;

                    // Set correct internal port for auto-detected project types
                    if (!params.internalPort) {
                        if (detection.type === 'nextjs') {
                            internalPort = 3000;
                        } else if (['node-generic', 'node-backend'].includes(detection.type)) {
                            internalPort = 3000;
                        } else {
                            internalPort = 80;
                        }
                    }
                } else {
                    addLog('❌ [Final] Deployment Failed: Could not auto-detect project type.');
                    addLog('   Please add a Dockerfile to your repository root, or use a supported framework (Next.js / Vite React).');
                    failureStage = 'validation_failed';
                    throw new Error('No Dockerfile found and could not auto-generate one for this project type.');
                }
            }
        } catch (e) {
            if (!failureStage) failureStage = 'validation_failed';
            throw e;
        }

        // Get commit hash (useful for traceability)
        try {
            const { stdout } = await execAsync(`cd ${projectPath} && git rev-parse HEAD`);
            commitHash = stdout.trim().substring(0, 12);
            addLog(`📌 Commit: ${commitHash}`);
        } catch (e) {
            addLog('⚠️ Could not get commit hash');
        }

        // Build
        addLog('🔨 [2/6] Building Docker image...');

        let finalBuildCommand;
        if (buildCommand) {
            finalBuildCommand = buildCommand;
        } else if (dockerfilePath) {
            finalBuildCommand = `docker build -t ${imageName} -f ${dockerfilePath} ${projectPath}`;
        } else {
            finalBuildCommand = `docker build -t ${imageName} ${projectPath}`;
        }

        try {
            await execAsync(finalBuildCommand, { timeout: 1000 * 60 * 10 }); // 10 min
            addLog('✅ [2/6] Docker image built successfully');
        } catch (buildErr) {
            failureStage = 'build_failed';
            addLog(`❌ [2/6] Docker build failed`);

            // Capture and display the full Docker build output (stdout + stderr)
            // so the actual Next.js / npm error is visible in deployment logs
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

        // === DEMO INSTRUCTION (for Option 1 subdomain + Let's Encrypt via NPM) ===
        addLog(`📌 [DEMO] To expose on nice subdomain with your existing Let's Encrypt cert:`);
        addLog(`   1. Open Nginx Proxy Manager UI`);
        addLog(`   2. Create new Proxy Host:`);
        addLog(`      Domain: demo-web.hgu.app   (or any subdomain you prepared)`);
        addLog(`      Forward Hostname/IP: ${serverHost}`);
        addLog(`      Forward Port: ${externalPort}`);
        addLog(`      Enable SSL → Use your existing Let's Encrypt certificate`);
        addLog(`   3. After creation, the service will be available at https://demo-web.hgu.app`);
        // === End demo instruction ===

        // Build env var string
        let envString = '';
        Object.keys(envVars).forEach(key => {
            envString += ` -e ${key}="${envVars[key]}"`;
        });

        const runCommand = `docker run -d --name ${containerName} -p ${externalPort}:${internalPort}${envString} ${imageName}`;
        
        try {
            await execAsync(runCommand);
            addLog('✅ [3/6] Container started');
            containerStarted = true;
        } catch (runErr) {
            failureStage = 'container_start_failed';
            addLog(`❌ [3/6] Failed to start container`);
            throw runErr;
        }

        // Basic health check (give it 3 seconds)
        addLog('🩺 [4/6] Running basic health check...');
        await new Promise(r => setTimeout(r, 3000));

        let healthStatus = 'unknown';
        try {
            const { stdout } = await execAsync(`docker inspect --format='{{.State.Health.Status}}' ${containerName} 2>/dev/null || echo "no-healthcheck"`);
            healthStatus = stdout.trim();
            addLog(`🩺 Health status: ${healthStatus}`);
        } catch (e) {
            addLog('🩺 No healthcheck defined in image (common for student projects)');
        }

        // (URL variables already calculated earlier for logging)

        // Save to DB (with owner for per-user isolation)
        console.log(`[DB INSERT DEBUG] githubUserId=${githubUserId} (type: ${typeof githubUserId}) for project "${projectName}"`);
        await safeInsertDeployment(pool, {
            projectName,
            repository,
            containerName,
            imageName,
            port: externalPort,
            url,
            status: 'running',
            serviceType: 'web',
            githubUserId
        });

        addLog('✅ [5/6] Deployment recorded in database');

        if (dockerfilePath && dockerfilePath.includes('templates')) {
            addLog('ℹ️  Note: This deployment used an auto-generated Dockerfile (no Dockerfile was found in your repo).');
        }

        addLog('✅ [6/6] Web service is now live');
        addLog(`🌐 Final access URL: ${url}`);
        if (!PUBLIC_DOMAIN || PUBLIC_DOMAIN === 'hgu.app') {
            addLog('   (Subdomain may not work in lab environments without DNS setup — use the port URL above.)');
        }

        return {
            success: true,
            url,
            serviceType: 'web',
            externalPort,
            internalPort,
            commitHash,
            healthStatus,
            deploymentId,
            failureStage: null
        };

    } catch (error) {
        // Clean up the container if it was started but later steps failed.
        // This releases the port (mirrors the logic we added for Function).
        if (containerStarted && containerName) {
            try {
                addLog('🧹 Cleaning up failed Web container (port will be released)...');
                await execAsync(`docker stop ${containerName} || true`);
                await execAsync(`docker rm ${containerName} || true`);
            } catch (cleanupErr) {
                addLog(`⚠️ Container cleanup warning: ${cleanupErr.message}`);
            }
        }

        addLog(`❌ Web deployment failed at stage: ${failureStage || 'unknown'}`);
        addLog(`Error: ${error.message}`);

        // Emit a clear final failure line (same principle as APK's [Final] message)
        addLog(`❌ [Final] Deployment Failed at stage: ${failureStage || 'unknown'}. ${error.message}`);

        // Still try to record the failure in DB for visibility (spec emphasizes this)
        try {
            await safeInsertDeployment(pool, {
                projectName,
                repository,
                containerName: containerName || `failed-${deploymentId}`,
                imageName: imageName || `failed-${deploymentId}`,
                port: null,  // do not record port for failed records, so MAX(port) is not inflated by failed attempts; only successful ones reserve the port number
                url: 'Deployment failed',
                status: 'failed',
                serviceType: 'web'
            });
        } catch (dbErr) {
            console.error('Failed to record failure in DB:', dbErr.message);
        }

        // Throw with stage information so caller can show it nicely
        const enhancedError = new Error(error.message);
        enhancedError.failureStage = failureStage || 'unknown';
        enhancedError.stage = failureStage;
        throw enhancedError;
    }
}

module.exports = {
    deploy
};
