const fs = require('fs');
const path = require('path');

function readFileSafe(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        return '';
    }
}

/** Best-effort framework sniff for a Python project: looks for the package
 *  name in whichever dependency file is present. Order matters — check the
 *  more specific framework first since a project can list both (e.g. a
 *  FastAPI app that also happens to depend on Flask utilities). */
function detectPythonFramework(projectPath) {
    const depFiles = ['requirements.txt', 'pyproject.toml', 'Pipfile']
        .map(f => path.join(projectPath, f))
        .filter(f => fs.existsSync(f));

    const contents = depFiles.map(readFileSafe).join('\n').toLowerCase();

    if (contents.includes('fastapi')) return 'fastapi';
    if (contents.includes('flask')) return 'flask';
    return 'generic';
}

/**
 * Detects common project types across the languages this platform builds
 * Dockerfiles for. Language-specific marker files (pom.xml, go.mod,
 * manage.py, requirements.txt/pyproject.toml/Pipfile) are checked first
 * since they're unambiguous; the existing Node/JS cascade (via package.json)
 * runs after, followed by the static-site fallback.
 */
function detectProjectType(projectPath) {
    try {
        // --- Java ---
        if (fs.existsSync(path.join(projectPath, 'pom.xml'))) {
            return { type: 'java-maven', framework: 'java' };
        }
        if (fs.existsSync(path.join(projectPath, 'build.gradle')) ||
            fs.existsSync(path.join(projectPath, 'build.gradle.kts'))) {
            return { type: 'java-gradle', framework: 'java' };
        }

        // --- Go ---
        if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
            return { type: 'go', framework: 'go' };
        }

        // --- Python ---
        if (fs.existsSync(path.join(projectPath, 'manage.py'))) {
            return { type: 'python-django', framework: 'django' };
        }
        const hasPythonDeps = ['requirements.txt', 'pyproject.toml', 'Pipfile']
            .some(f => fs.existsSync(path.join(projectPath, f)));
        if (hasPythonDeps) {
            const framework = detectPythonFramework(projectPath);
            return { type: `python-${framework}`, framework };
        }

        // --- Node / JS (existing detection) ---
        const packageJsonPath = path.join(projectPath, 'package.json');

        if (!fs.existsSync(packageJsonPath)) {
            // Check for pre-built static site (dist or build folder is common in student projects)
            if (fs.existsSync(path.join(projectPath, 'dist')) || fs.existsSync(path.join(projectPath, 'build'))) {
                return { type: 'static', framework: 'static' };
            }
            if (fs.existsSync(path.join(projectPath, 'index.html'))) {
                return { type: 'static', framework: 'static' };
            }
            return { type: 'unknown', framework: null };
        }

        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const devDeps = pkg.devDependencies || {};
        const hasReact = !!deps.react;
        const hasVite = !!devDeps.vite || !!deps.vite;

        // 1. Next.js (highest priority for modern student projects)
        const hasNextConfig = fs.existsSync(path.join(projectPath, 'next.config.js')) ||
                              fs.existsSync(path.join(projectPath, 'next.config.mjs')) ||
                              fs.existsSync(path.join(projectPath, 'next.config.ts'));
        const hasAppDir = fs.existsSync(path.join(projectPath, 'app'));
        const hasPagesDir = fs.existsSync(path.join(projectPath, 'pages'));

        if (deps.next || hasNextConfig || hasAppDir || hasPagesDir) {
            return { type: 'nextjs', framework: 'next.js' };
        }

        // 2. Vite + React (most common modern student/portfolio SPA)
        const hasViteConfig = fs.existsSync(path.join(projectPath, 'vite.config.js')) ||
                              fs.existsSync(path.join(projectPath, 'vite.config.ts')) ||
                              fs.existsSync(path.join(projectPath, 'vite.config.mjs'));

        if ((hasViteConfig || hasVite) && hasReact) {
            return { type: 'vite-react', framework: 'react' };
        }
        if (hasViteConfig || hasVite) {
            return { type: 'vite', framework: 'vite' };
        }

        // 3. Create React App
        if (deps['react-scripts']) {
            return { type: 'cra', framework: 'react' };
        }

        // 4. Generic React
        if (hasReact) {
            return { type: 'react', framework: 'react' };
        }

        // 5. Node.js backend (express, fastify, etc.)
        if (deps.express || deps.fastify || deps.koa) {
            return { type: 'node-backend', framework: 'node' };
        }

        // 6. Fallback: has package.json + build script → generic web (SPA capable via nginx template)
        if (pkg.scripts && (pkg.scripts.build || pkg.scripts['build:web'])) {
            return { type: 'generic-web', framework: 'web' };
        }

        // 7. Final fallback
        return { type: 'node-generic', framework: 'node' };

    } catch (err) {
        console.error('Project detection error:', err);
        return { type: 'unknown', framework: null };
    }
}

module.exports = {
    detectProjectType
};
