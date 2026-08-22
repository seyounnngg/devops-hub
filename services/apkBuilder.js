const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { safeInsertDeployment } = require('../utils/dbHelpers');
const { assertSafeRepository, assertSafeBranch, assertSafePathSegment } = require('../utils/validate');
const { getOrCreateSigningKey, BUILD_IMAGE, KEYSTORE_DIR } = require('../utils/signingKey');

const BUILD_MEM_LIMIT = process.env.DEPLOY_BUILD_MEM_LIMIT || '3g';
const BUILD_CPU_LIMIT = process.env.DEPLOY_BUILD_CPU_LIMIT || '2';

/**
 * Pure Node.js recursive file search.
 * Replaces fragile `find` shell commands that fail in minimal Alpine containers
 * (missing findutils package). Works reliably with fs.readdirSync.
 */
function findFileRecursive(startDir, targetName) {
    const queue = [startDir];
    while (queue.length > 0) {
        const current = queue.shift();
        try {
            const entries = fs.readdirSync(current, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    queue.push(full);
                } else if (entry.name === targetName) {
                    return full;
                }
            }
        } catch (e) {
            // Skip directories we cannot read (permissions, broken symlinks, etc.)
        }
    }
    return null;
}

/** Streams `git clone` without a shell, so branch/repository can never be
 *  interpreted as shell syntax. The token is passed via a credential helper
 *  reading from an env var (GIT_TOKEN), never as part of argv or the URL. */
function streamingCloneRepo({ githubUsername, repository, branch, githubToken, destPath, addLog }) {
    assertSafeRepository(repository);
    assertSafeBranch(branch);

    const repoUrl = `https://github.com/${githubUsername}/${repository}.git`;
    const credentialHelper = '!f() { echo username=x-access-token; echo password=$GIT_TOKEN; }; f';

    return new Promise((resolve, reject) => {
        const child = spawn('git', [
            '-c', `credential.helper=${credentialHelper}`,
            'clone',
            '--branch', branch,
            '--single-branch',
            repoUrl,
            destPath
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, GIT_TOKEN: githubToken }
        });

        child.stdout.on('data', (data) => {
            data.toString().trim().split('\n').forEach(line => { if (line.trim()) addLog(line.trim()); });
        });
        child.stderr.on('data', (data) => {
            data.toString().trim().split('\n').forEach(line => { if (line.trim()) addLog(line.trim()); });
        });

        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Git clone failed with exit code ${code}`));
        });
        child.on('error', reject);
    });
}

/** Detects Flutter / React Native / plain Android(Gradle), in that priority
 *  order (a Flutter or RN project also contains a nested android/build.gradle,
 *  so the more specific checks must run first). */
function detectMobileProject(projectPath) {
    const pubspecPath = findFileRecursive(projectPath, 'pubspec.yaml');
    if (pubspecPath) {
        return { type: 'flutter', root: path.dirname(pubspecPath) };
    }

    const packageJsonPath = findFileRecursive(projectPath, 'package.json');
    if (packageJsonPath) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const rnRoot = path.dirname(packageJsonPath);
            if (deps['react-native'] && fs.existsSync(path.join(rnRoot, 'android', 'build.gradle'))) {
                return { type: 'react-native', root: rnRoot };
            }
        } catch (e) {
            // malformed package.json — fall through to plain Gradle detection
        }
    }

    const gradlePath = findFileRecursive(projectPath, 'build.gradle');
    if (gradlePath) {
        return { type: 'android', root: path.dirname(gradlePath) };
    }

    return null;
}

/** Shell script run inside BUILD_IMAGE with the project root mounted at /app
 *  and the keystore directory mounted read-only at /keystores. Builds an APK
 *  + AAB, then re-signs both with the project's managed key. Emits
 *  DEVOPSHUB_* marker lines the host parses out of the captured output. */
function buildAndSignScript({ type, keystoreFile, alias }) {
    let buildCmds;

    if (type === 'flutter') {
        buildCmds = `
flutter config --no-analytics --suppress-analytics >/dev/null 2>&1 || true
yes | flutter doctor --android-licenses >/dev/null 2>&1 || true
flutter precache --android
flutter pub get
flutter build apk --release --no-pub
flutter build appbundle --release --no-pub
`.trim();
    } else if (type === 'react-native') {
        buildCmds = `
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq nodejs npm >/dev/null 2>&1
npm install --no-audit --no-fund
cd android
./gradlew assembleRelease bundleRelease --no-daemon
cd ..
`.trim();
    } else {
        buildCmds = `./gradlew assembleRelease bundleRelease --no-daemon`;
    }

    return `set -e
cd /app
${buildCmds}

APK=$(find . -path '*/outputs/*' -name '*.apk' | grep -v -- '-unsigned' | head -1)
if [ -z "$APK" ]; then
  APK=$(find . -path '*/outputs/*' -name '*.apk' | head -1)
fi
AAB=$(find . -path '*/outputs/*' -name '*.aab' | head -1)
echo "DEVOPSHUB_FOUND_APK=$APK"
echo "DEVOPSHUB_FOUND_AAB=$AAB"

BT=$(ls -d "$ANDROID_HOME"/build-tools/*/ 2>/dev/null | sort -V | tail -1)

if [ -n "$APK" ]; then
  "\${BT}zipalign" -f -v 4 "$APK" /tmp/aligned.apk \
    && "\${BT}apksigner" sign --ks /keystores/${keystoreFile} --ks-pass env:KS_STORE_PW --key-pass env:KS_KEY_PW --ks-key-alias ${alias} --out /tmp/signed.apk /tmp/aligned.apk \
    && "\${BT}apksigner" verify /tmp/signed.apk \
    && cp /tmp/signed.apk "\${APK%.apk}-devopshub-signed.apk" \
    && echo "DEVOPSHUB_SIGNED_APK=\${APK%.apk}-devopshub-signed.apk" \
    || echo "DEVOPSHUB_SIGN_APK_FAILED=1"
fi

if [ -n "$AAB" ]; then
  cp "$AAB" /tmp/signed.aab \
    && jarsigner -storepass:env KS_STORE_PW -keypass:env KS_KEY_PW -digestalg SHA-256 -sigalg SHA256withRSA -keystore /keystores/${keystoreFile} /tmp/signed.aab ${alias} \
    && jarsigner -verify /tmp/signed.aab \
    && cp /tmp/signed.aab "\${AAB%.aab}-devopshub-signed.aab" \
    && echo "DEVOPSHUB_SIGNED_AAB=\${AAB%.aab}-devopshub-signed.aab" \
    || echo "DEVOPSHUB_SIGN_AAB_FAILED=1"
fi
`;
}

function parseMarker(output, key) {
    const match = output.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : null;
}

/**
 * Mobile app builder — Flutter, plain Android (Gradle), and React Native.
 * Produces a signed release APK and AAB, both signed with a key generated
 * once per project and reused for every later build of that project.
 */
async function build(params, { addLog }) {
    const {
        name: projectName,
        repository,
        branch,
        githubToken,
        githubUsername,
        pool,
        githubUserId = null
    } = params;

    addLog('📱 Starting mobile app build...');
    addLog('📦 Cloning repository...');

    const deploymentId = Date.now();
    const projectPath = `/tmp/apk-builds/${projectName}-${deploymentId}`;

    try {
        fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    } catch (e) {
        // ignore if already exists
    }

    try {
        await streamingCloneRepo({ githubUsername, repository, branch, githubToken, destPath: projectPath, addLog });
        addLog('✅ Repository cloned successfully');

        addLog('🔍 Detecting project type...');
        const detection = detectMobileProject(projectPath);

        if (!detection) {
            addLog('❌ pubspec.yaml, build.gradle, or a React Native package.json could not be found.');
            addLog('   Supported: Flutter, React Native, and plain Android (Gradle) projects.');
            throw new Error('Not a recognized Flutter, React Native, or Android project.');
        }

        assertSafePathSegment(detection.root, 'project path');
        addLog(`✅ Detected ${detection.type} project at: ${detection.root}`);

        addLog(`🐳 Ensuring build image is ready (${BUILD_IMAGE})...`);
        await new Promise((resolve) => {
            const child = spawn('docker', ['pull', BUILD_IMAGE], { stdio: ['ignore', 'pipe', 'pipe'] });
            child.stdout.on('data', (d) => d.toString().trim().split('\n').forEach(l => { if (l.trim()) addLog(`   [pull] ${l.trim()}`); }));
            child.stderr.on('data', (d) => d.toString().trim().split('\n').forEach(l => { if (l.trim()) addLog(`   [pull] ${l.trim()}`); }));
            child.on('close', () => resolve());
            child.on('error', (err) => { addLog(`⚠️ Pull error: ${err.message} (continuing with cached image if available)`); resolve(); });
        });

        addLog('🔑 Preparing release signing key for this project...');
        const signingKey = await getOrCreateSigningKey(pool, { githubUserId, projectName });
        addLog(signingKey.reused
            ? '✅ Reusing existing signing key (consistent with previous builds of this project).'
            : '✅ Generated a new release signing key for this project.');

        const keystoreFile = path.basename(signingKey.keystorePath);
        const script = buildAndSignScript({ type: detection.type, keystoreFile, alias: signingKey.alias });

        const dockerArgs = [
            'run', '--rm',
            '--memory', BUILD_MEM_LIMIT,
            '--cpus', BUILD_CPU_LIMIT,
            '-v', `${detection.root}:/app`,
            '-v', `${KEYSTORE_DIR}:/keystores:ro`,
            '-e', 'KS_STORE_PW',
            '-e', 'KS_KEY_PW'
        ];

        if (detection.type === 'flutter') {
            dockerArgs.push(
                '-v', 'flutter-gradle-cache:/root/.gradle',
                '-v', 'flutter-pub-cache:/root/.pub-cache',
                '-v', 'flutter-cache:/root/.cache',
                '-e', 'GRADLE_USER_HOME=/root/.gradle',
                '-e', 'GRADLE_OPTS=-Dorg.gradle.daemon=false -Dorg.gradle.parallel=true -Dorg.gradle.caching=true'
            );
        }

        dockerArgs.push('-w', '/app', BUILD_IMAGE, 'sh', '-c', script);

        addLog('🔨 Starting build (typically 1-5 minutes with cache)...');

        const buildOutput = await new Promise((resolve, reject) => {
            const child = spawn('docker', dockerArgs, {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, KS_STORE_PW: signingKey.storePassword, KS_KEY_PW: signingKey.keyPassword }
            });

            let combined = '';
            child.stdout.on('data', (data) => {
                const text = data.toString();
                combined += text;
                text.trim().split('\n').forEach(line => { if (line.trim()) addLog(line.trim()); });
            });
            child.stderr.on('data', (data) => {
                const text = data.toString();
                combined += text;
                text.trim().split('\n').forEach(line => { if (line.trim()) addLog(line.trim()); });
            });

            child.on('close', (code) => {
                if (code === 0) resolve(combined);
                else reject(new Error(`Build exited with code ${code}`));
            });
            child.on('error', reject);
        });

        addLog('✅ Build completed');

        const signedApkRel = parseMarker(buildOutput, 'DEVOPSHUB_SIGNED_APK');
        const signedAabRel = parseMarker(buildOutput, 'DEVOPSHUB_SIGNED_AAB');
        const foundApkRel = parseMarker(buildOutput, 'DEVOPSHUB_FOUND_APK');
        const foundAabRel = parseMarker(buildOutput, 'DEVOPSHUB_FOUND_AAB');

        if (parseMarker(buildOutput, 'DEVOPSHUB_SIGN_APK_FAILED')) {
            addLog('⚠️ APK signing failed — falling back to the unsigned/default-signed build output.');
        }
        if (parseMarker(buildOutput, 'DEVOPSHUB_SIGN_AAB_FAILED')) {
            addLog('⚠️ AAB signing failed — falling back to the unsigned/default-signed build output.');
        }

        const finalApkRel = signedApkRel || foundApkRel;
        const finalAabRel = signedAabRel || foundAabRel;

        if (!finalApkRel) {
            throw new Error('Build finished but no APK artifact was found in the outputs directory.');
        }

        await fs.promises.mkdir('/tmp/apks', { recursive: true });

        const apkFileName = `${projectName}-${deploymentId}.apk`;
        await fs.promises.copyFile(path.join(detection.root, finalApkRel), `/tmp/apks/${apkFileName}`);
        const apkUrl = `/apks/${apkFileName}`;
        addLog(`✅ APK ready${signedApkRel ? ' (signed)' : ' (unsigned fallback)'}`);

        let aabUrl = null;
        if (finalAabRel) {
            const aabFileName = `${projectName}-${deploymentId}.aab`;
            await fs.promises.copyFile(path.join(detection.root, finalAabRel), `/tmp/apks/${aabFileName}`);
            aabUrl = `/apks/${aabFileName}`;
            addLog(`✅ AAB ready${signedAabRel ? ' (signed)' : ' (unsigned fallback)'} — for Play Store upload`);
        } else {
            addLog('ℹ️ No AAB artifact was produced for this project type.');
        }

        await safeInsertDeployment(pool, {
            projectName,
            repository,
            containerName: `apk-build-${deploymentId}`,
            imageName: `apk-image-${deploymentId}`,
            port: null,
            url: apkUrl,
            status: 'completed',
            serviceType: 'apk',
            apkUrl,
            aabUrl,
            githubUserId
        });

        return {
            success: true,
            serviceType: 'apk',
            downloadUrl: apkUrl,
            aabUrl,
            message: 'Build succeeded'
        };

    } catch (error) {
        addLog(`❌ Mobile app build failed: ${error.message}`);

        try {
            await safeInsertDeployment(pool, {
                projectName,
                repository,
                containerName: `apk-build-${deploymentId}`,
                imageName: `apk-image-${deploymentId}`,
                port: null,
                url: 'Build failed',
                status: 'failed',
                serviceType: 'apk',
                githubUserId
            });
        } catch (dbErr) {
            console.error('Failed to record APK build failure:', dbErr.message);
        }

        throw error;
    } finally {
        try {
            await fs.promises.rm(projectPath, { recursive: true, force: true });
        } catch (e) {
            addLog(`⚠️ Could not clean up build directory: ${e.message}`);
        }
    }
}

module.exports = {
    build
};
