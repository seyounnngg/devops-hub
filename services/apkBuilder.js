const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');
const { safeInsertDeployment } = require('../utils/dbHelpers');

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

/**
 * APK Builder
 * 
 * Priority: Support building simple Flutter / basic Android apps.
 * 
 * Current status: STUB with real build path prepared.
 * 
 * Strategy for simple apps:
 * - Use a Docker image that contains Android SDK + Flutter (e.g. cirrusci/flutter or custom)
 * - Run flutter build apk or ./gradlew assembleRelease
 * - Store the resulting .apk and return a download link
 * 
 * For the first working version we will implement a basic working version for simple projects.
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

    addLog('📱 Starting APK Build...');
    addLog('📦 Cloning repository for APK build...');

    const deploymentId = Date.now();
    const projectPath = `/tmp/apk-builds/${projectName}-${deploymentId}`;

    // Ensure the build directory exists (important when using Docker volume mounts from host)
    try {
        fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    } catch (e) {
        // ignore if already exists
    }

    const cloneCommand = `git clone --branch ${branch} https://${githubToken}@github.com/${githubUsername}/${repository}.git ${projectPath}`;

    // Debug: show the clone command (token redacted for safety)
    const redactedCommand = cloneCommand.replace(githubToken, '***TOKEN***');
    addLog(`DEBUG clone command: ${redactedCommand}`);

    try {
        // Use spawn for real-time logging of clone output (stdout + stderr)
        addLog('📦 Cloning repository...');

        await new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const child = spawn('/bin/sh', ['-c', cloneCommand], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            child.stdout.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach(line => {
                    if (line.trim()) addLog(line.trim());
                });
            });

            child.stderr.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach(line => {
                    if (line.trim()) addLog(line.trim());
                });
            });

            child.on('close', (code) => {
                if (code === 0) {
                    // List directory contents for debugging
                    try {
                        const contents = fs.readdirSync(projectPath);
                        addLog(`DEBUG: Directory contents after clone: ${contents.length > 0 ? contents.join(', ') : '(empty)'}`);
                    } catch (e) {
                        addLog('DEBUG: Could not read cloned directory');
                    }

                    // Robust validation using pure Node.js (no shell `find` dependency)
                    const pubspecFoundPath = findFileRecursive(projectPath, 'pubspec.yaml');

                    if (!pubspecFoundPath) {
                        addLog('⚠️ Git clone reported success, but no pubspec.yaml was found anywhere in the cloned directory.');
                        addLog('This is a very strong sign that your GitHub token does not have permission to clone this private repository.');
                        addLog('→ Please go to GitHub → Settings → Developer settings → Personal access tokens');
                        addLog('→ Make sure it is a Classic token with the "repo" scope fully checked.');
                        addLog('❌ [Final] Deployment Failed: pubspec.yaml 파일을 찾을 수 없습니다.');
                        addLog('   현재 APK Build는 Flutter 프로젝트만 지원합니다.');
                        reject(new Error('No Flutter project found (pubspec.yaml missing). Check if this is a valid Flutter project and token scopes.'));
                        return;
                    }

                    addLog('✅ Repository cloned successfully with project files');
                    resolve();
                } else {
                    reject(new Error(`Git clone failed with exit code ${code}`));
                }
            });

            child.on('error', (err) => {
                reject(err);
            });
        });

        // === Improved Flutter / Android project root detection ===
        addLog('🔍 Detecting project root...');

        // Find project files using pure Node.js recursive search (reliable, no shell dependency)
        const pubspecPath = findFileRecursive(projectPath, 'pubspec.yaml');
        const gradlePath = findFileRecursive(projectPath, 'build.gradle');

        let buildCommand = '';
        let artifactPath = '';
        let flutterProjectRoot = null;

        // Use a modern, actively maintained Flutter image (the old cirrusci/flutter is dead and ships ancient Dart 2.x)
        const useFlutterImage = 'ghcr.io/cirruslabs/flutter:stable';

        if (pubspecPath) {
            flutterProjectRoot = path.dirname(pubspecPath);
            addLog(`✅ Flutter project root detected: ${flutterProjectRoot}`);

            // === Explicit image pull phase for better visibility ===
            addLog(`🐳 Ensuring Flutter build image is ready (${useFlutterImage})...`);

            const pullCommand = `docker pull ${useFlutterImage}`;
            await new Promise((resolve, reject) => {
                const { spawn } = require('child_process');
                const child = spawn('/bin/sh', ['-c', pullCommand], {
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                child.stdout.on('data', (data) => {
                    const lines = data.toString().trim().split('\n');
                    lines.forEach(line => {
                        if (line.trim()) addLog(`   [pull] ${line.trim()}`);
                    });
                });
                child.stderr.on('data', (data) => {
                    const lines = data.toString().trim().split('\n');
                    lines.forEach(line => {
                        if (line.trim()) addLog(`   [pull] ${line.trim()}`);
                    });
                });

                child.on('close', (code) => {
                    if (code === 0) {
                        addLog(`✅ Flutter image is ready`);
                        resolve();
                    } else {
                        addLog(`⚠️ docker pull exited with code ${code} (may still work if image is cached)`);
                        resolve(); // Continue anyway - image might already be present
                    }
                });

                child.on('error', (err) => {
                    addLog(`⚠️ Pull error: ${err.message} (continuing with cached image if available)`);
                    resolve();
                });
            });

            // B1 Optimization: Faster subsequent builds (v2)
            // - Additional Flutter tool cache volume
            // - Gradle parallel + no-daemon for CI speed
            // - Better sdkmanager install syntax + analytics disabled
            buildCommand = `docker run --rm \
              -v "${flutterProjectRoot}:/app" \
              -v flutter-gradle-cache:/root/.gradle \
              -v flutter-pub-cache:/root/.pub-cache \
              -v flutter-cache:/root/.cache \
              -e GRADLE_USER_HOME=/root/.gradle \
              -e GRADLE_OPTS="-Dorg.gradle.daemon=false -Dorg.gradle.parallel=true -Dorg.gradle.caching=true" \
              -w /app ${useFlutterImage} \
              sh -c '
                cat > /tmp/build.sh << "EOL"
flutter config --no-analytics --suppress-analytics >/dev/null 2>&1 || true
sdkmanager --install "ndk;28.2.13676358" "cmake;3.22.1" >/dev/null 2>&1 || true
yes | flutter doctor --android-licenses >/dev/null 2>&1 || true
flutter precache --android
flutter pub get
flutter build apk --release --no-pub
EOL
                chmod +x /tmp/build.sh
                /tmp/build.sh
              '`;

            artifactPath = `${flutterProjectRoot}/build/app/outputs/flutter-apk/app-release.apk`;

        } else if (gradlePath) {
            const androidProjectRoot = path.dirname(gradlePath);
            addLog(`✅ Android project root detected: ${androidProjectRoot}`);

            buildCommand = `docker run --rm -v "${androidProjectRoot}:/app" -w /app openjdk:17-jdk sh -c "./gradlew assembleRelease"`;
            artifactPath = `${androidProjectRoot}/app/build/outputs/apk/release/app-release.apk`;

        } else {
            addLog('❌ pubspec.yaml 또는 build.gradle 파일을 찾을 수 없습니다.');
            addLog('   현재 APK Build는 Flutter 프로젝트와 기본 Android 프로젝트만 지원합니다.');
            throw new Error('Not a valid Flutter or Android project.');
        }

        addLog('🔨 Starting APK build (typically 5-10 minutes with cache)...');

        // Stream real build logs using /bin/sh (more portable in Alpine containers)
        await new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const child = spawn('/bin/sh', ['-c', buildCommand], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            child.stdout.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach(line => {
                    if (line.trim()) addLog(line.trim());
                });
            });

            child.stderr.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach(line => {
                    if (line.trim()) addLog(line.trim());
                });
            });

            child.on('close', (code) => {
                if (code === 0) {
                    addLog('✅ APK build completed');
                    resolve();
                } else {
                    reject(new Error(`APK build exited with code ${code}`));
                }
            });

            child.on('error', (err) => {
                reject(err);
            });
        });

        let downloadUrl = null;
        try {
            await execAsync(`test -f "${artifactPath}"`);

            await execAsync('mkdir -p /tmp/apks');

            const fileName = `${projectName}-${deploymentId}.apk`;
            const finalApkPath = `/tmp/apks/${fileName}`;

            await execAsync(`cp "${artifactPath}" "${finalApkPath}"`);

            downloadUrl = `/apks/${fileName}`;
            addLog(`✅ APK ready for download`);
        } catch (err) {
            addLog('❌ APK artifact not found after build.');
            console.error('APK copy error:', err);
            downloadUrl = null;
        }

        // Record in DB (with owner for per-user isolation)
        await safeInsertDeployment(pool, {
            projectName,
            repository,
            containerName: `apk-build-${deploymentId}`,
            imageName: `apk-image-${deploymentId}`,
            port: null,
            url: downloadUrl || 'Build failed',
            status: downloadUrl ? 'completed' : 'failed',
            serviceType: 'apk',
            apkUrl: downloadUrl,
            githubUserId
        });

        return {
            success: !!downloadUrl,
            serviceType: 'apk',
            downloadUrl,
            message: downloadUrl 
                ? 'APK build succeeded' 
                : 'APK build failed. Check logs for details.'
        };

    } catch (error) {
        addLog(`❌ APK build process error: ${error.message}`);
        throw error;
    }
}

module.exports = {
    build
};
