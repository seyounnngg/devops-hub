const webDeployer = require('./webDeployer');
const apkBuilder = require('./apkBuilder');
const functionDeployer = require('./functionDeployer');
const cronDeployer = require('./cronDeployer');

/**
 * Dispatches deployment to the correct service handler based on serviceType.
 * This is the main entry point for all deployments.
 * 
 * According to Requirement Engineering doc (Team 8):
 * - Web is the main/primary service type (highest priority)
 * - APK should support building simple apps
 * - Function and Cron can be simpler/stub forms initially
 */
async function deployProject(params, { addLog, onComplete, onError }) {
    const { serviceType } = params;

    try {
        addLog(`🚀 Deployment started for service type: ${serviceType}`);

        let result;

        switch (serviceType) {
            case 'web':
                result = await webDeployer.deploy(params, { addLog });
                break;

            case 'apk':
                result = await apkBuilder.build(params, { addLog });
                break;

            case 'function':
                result = await functionDeployer.deploy(params, { addLog });
                break;

            case 'cron':
                result = await cronDeployer.register(params, { addLog });
                break;

            default:
                throw new Error(`Unsupported serviceType: ${serviceType}`);
        }

        addLog('✅ Deployment process completed');
        if (onComplete) onComplete(result);
        return result;

    } catch (error) {
        addLog(`❌ Deployment failed: ${error.message}`);
        if (onError) onError(error);

        // Always ensure a failed record exists in DB so it appears on Dashboard
        // even for early failures (missing script file, clone error, etc.)
        try {
            const { safeInsertDeployment } = require('../utils/dbHelpers');
            const { pool, name: projectName, repository, githubUserId, serviceType } = params;

            if (pool && projectName && githubUserId) {
                await safeInsertDeployment(pool, {
                    projectName,
                    repository: repository || null,
                    containerName: null,
                    imageName: null,
                    port: null,
                    url: null,
                    status: 'failed',
                    serviceType: serviceType || 'unknown',
                    githubUserId
                });
            }
        } catch (dbErr) {
            console.error('Failed to insert failed deployment record:', dbErr.message);
        }

        throw error;
    }
}

module.exports = {
    deployProject
};
