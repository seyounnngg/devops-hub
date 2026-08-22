const webDeployer = require('./webDeployer');
const apkBuilder = require('./apkBuilder');
const { safeInsertDeployment } = require('../utils/dbHelpers');

/**
 * Dispatches deployment to the correct service handler based on serviceType.
 * Web and APK are the only supported service types — Function and Cron were
 * removed (stub-only implementations with no real isolation or resource
 * limits; see services/README.md for history).
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

            default:
                throw new Error(`Unsupported serviceType: ${serviceType}`);
        }

        addLog('✅ Deployment process completed');
        if (onComplete) onComplete(result);
        return result;

    } catch (error) {
        addLog(`❌ Deployment failed: ${error.message}`);
        if (onError) onError(error);

        try {
            const { pool, name: projectName, repository, githubUserId, serviceType: st } = params;

            if (pool && projectName && githubUserId) {
                await safeInsertDeployment(pool, {
                    projectName,
                    repository: repository || null,
                    containerName: null,
                    imageName: null,
                    port: null,
                    url: null,
                    status: 'failed',
                    serviceType: st || 'unknown',
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
