const path = require('path');

// Host-visible working directories. apkBuilder hands these paths straight to the host
// Docker daemon as bind mounts, so deploy-backend.sh must mount each one at the same
// path inside hub-backend-app. Defaults keep the old /tmp layout.
const DATA_DIR = process.env.DEVOPS_HUB_DATA_DIR || '/tmp';

module.exports = {
    DATA_DIR,
    DEPLOYMENTS_DIR: path.join(DATA_DIR, 'deployments'),
    APK_BUILD_DIR: path.join(DATA_DIR, 'apk-builds'),
    APK_DIR: path.join(DATA_DIR, 'apks'),
    KEYSTORE_DIR: process.env.KEYSTORE_DIR || path.join(DATA_DIR, 'apk-keystores'),
};
