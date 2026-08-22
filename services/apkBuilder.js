const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const path = require('path');
const fs = require('fs');
const { safeInsertDeployment } = require('../utils/dbHelpers');
const { assertSafeRepository, assertSafeBranch, assertSafePathSegment } = require('../utils/validate');

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

/**
 * APK Builder — supports Flutter and basic Android (Gradle) projects.
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

    try {
        fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    } catch (e) {
        // ignore if already exists
    }

    try {
        await streamingCloneRepo({ githubUsername, repository, branch, githubToken, destPath: projectPath, addLog });

        try {
            const contents = fs.readdirSync(projectPath);
            addLog(`DEBUG: Directory contents after clone: ${contents.length > 0 ? contents.join(', ') : '(empty)'}`);
        } catch (e) {
            addLog('DEBUG: Could not read cloned directory');
        }

        const pubspecFoundPath = findFileRecursive(projectPath, 'pubspec.yaml');

        if (!pubspecFoundPath) {
            addLog('⚠️ Git clone reported success, but no pubspec.yaml was found anywhere in the cloned directory.');
            addLog('This is a very strong sign that your GitHub token does not have permission to clone this private repository.');
            addLog('→ Please go to GitHub → Settings → Developer settings → Personal access tokens');
            addLog('→ Make sure it is a Classic token with the "repo" scope fully checked.');
            addLog('❌ [Final] Deployment Failed: pubspec.yaml 파일을 찾을 수 없습니다.');
            addLog('   현재 APK Build는 Flutter 프로젝트만 지원합니다.');
            throw new Error('No Flutter project found (pubspec.yaml missing). Check if this is a valid Flutter project and token scopes.');
        }

        addLog('✅ Repository cloned successfully with project files');

        // === Improved Flutter / Android project root detection ===
        addLog('🔍 Detecting project root...');

        const pubspecPath = findFileRecursive(projectPath, 'pubspec.yaml');
        const gradlePath = findFileRecursive(projectPath, 'build.gradle');

        let buildCommand = '';
        let artifactPath = '';
        let flutterProjectRoot = null;

        const useFlutterImage = 'ghcr.io/cirruslabs/flutter:stable';

        if (pubspecPath) {
            flutterProjectRoot = path.dirname(pubspecPath);
            // Defense in depth: the build command below still runs through `sh -c` for the Flutter
            // toolchain itself, so make sure nothing shell-meaningful made it into this path (it is
            // derived from directory names inside the user's own cloned repo).
            assertSafePathSegment(flutterProjectRoot, 'project path');
            addLog(`✅ Flutter project root detected: ${flutterProjectRoot}`);

            addLog(`🐳 Ensuring Flutter build image is ready (${useFlutterImage})...`);

            await new Promise((resolve) => {
                const child = spawn('docker', ['pull', useFlutterImage], { stdio: ['ignore', 'pipe', 'pipe'] });

                child.stdout.on('data', (data) => {
                    data.toString().trim().split('\n').forEach(line => { if (line.trim()) addLog(`   [pull] ${line.trim()}`); });
                });
                child.stderr.on('data', (data) => {
                    data.toString().trim().split('\n').forEach(line => { if (line.trim()) addLog(`   [pull] ${line.trim()}`); });
                });

                child.on('close', (code) => {
                    if (code === 0) addLog(`✅ Flutter image is ready`);
                    else addLog(`⚠️ docker pull exited with code ${code} (may still work if image is cached)`);
                    resolve();
                });
                child.on('error', (err) => {
                    addLog(`⚠️ Pull error: ${err.message} (continuing with cached image if available)`);
                    resolve();
                });
            });

            buildCommand = `docker run --rm \
              --memory ${BUILD_MEM_LIMIT} --cpus ${BUILD_CPU_LIMIT} \
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
            assertSafePathSegment(androidProjectRoot, 'project path');
            addLog(`✅ Android project root detected: ${androidProjectRoot}`);

            buildCommand = `docker run --rm --memory ${BUILD_MEM_LIMIT} --cpus ${BUILD_CPU_LIMIT} -v "${androidProjectRoot}:/app" -w /app openjdk:17-jdk sh -c "./gradlew assembleRelease"`;
            artifactPath = `${androidProjectRoot}/app/build/outputs/apk/release/app-release.apk`;

        } else {
            addLog('❌ pubspec.yaml 또는 build.gradle 파일을 찾을 수 없습니다.');
            addLog('   현재 APK Build는 Flutter 프로젝트와 기본 Android 프로젝트만 지원합니다.');
            throw new Error('Not a valid Flutter or Android project.');
        }

        addLog('🔨 Starting APK build (typically 1-5 minutes with cache)...');

        await new Promise((resolve, reject) => {
            const child = spawn('/bin/sh', ['-c', buildCommand], { stdio: ['ignore', 'pipe', 'pipe'] });

            child.stdout.on('data', (data) => {
                data.toString().trim().split('\n').forEach(line => { if (line.trim()) addLog(line.trim()); });
            });
            child.stderr.on('data', (data) => {
                data.toString().trim().split('\n').forEach(line => { if (line.trim()) addLog(line.trim()); });
            });

            child.on('close', (code) => {
                if (code === 0) {
                    addLog('✅ APK build completed');
                    resolve();
                } else {
                    reject(new Error(`APK build exited with code ${code}`));
                }
            });
            child.on('error', reject);
        });

        let downloadUrl = null;
        try {
            if (!fs.existsSync(artifactPath)) throw new Error('artifact not found');

            await fs.promises.mkdir('/tmp/apks', { recursive: true });

            const fileName = `${projectName}-${deploymentId}.apk`;
            const finalApkPath = `/tmp/apks/${fileName}`;

            await fs.promises.copyFile(artifactPath, finalApkPath);

            // Metadata only — actual downloads go through the authenticated
            // GET /deployments/:id/apk route (server.js), not this path directly.
            downloadUrl = `/apks/${fileName}`;
            addLog(`✅ APK build succeeded — download it from the deployment detail page.`);
        } catch (err) {
            addLog('❌ APK artifact not found after build.');
            console.error('APK copy error:', err);
            downloadUrl = null;
        }

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
