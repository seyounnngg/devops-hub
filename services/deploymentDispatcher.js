const webDeployer = require('./webDeployer');
const apkBuilder = require('./apkBuilder');

/**
 * Dispatches deployment to the correct service handler based on serviceType.
 * Web and APK are the only supported service types — Function and Cron were
 * removed (stub-only implementations with no real isolation or resource
 * limits; see services/README.md for history).
 *
 * Failure recording is entirely the individual deployer's job (webDeployer.js
 * / apkBuilder.js each self-record to `deployments`/`deployment_builds` in
 * their own catch blocks before rethrowing) — this used to *also* insert a
 * fallback failed row here, which just meant every failure was recorded
 * twice, and for a failed redeploy it inserted a bogus extra row for what
 * should stay a single existing project.
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
        throw error;
    }
}

module.exports = {
    deployProject
};
