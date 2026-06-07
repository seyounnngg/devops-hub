const fs = require('fs');
const path = require('path');

/**
 * Detects common web project types.
 * Priority: Next.js > Vite React > Create React App > Static > Unknown
 */
function detectProjectType(projectPath) {
    try {
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