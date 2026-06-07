const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '../templates');

/**
 * Generates or copies a Dockerfile into the project root based on detected type.
 * Returns the path to the Dockerfile that should be used for building.
 */
function ensureDockerfile(projectPath, detection) {
    const existingDockerfile = path.join(projectPath, 'Dockerfile');

    // If user already provided one, use it
    if (fs.existsSync(existingDockerfile)) {
        return existingDockerfile;
    }

    let templateName = null;

    switch (detection.type) {
        case 'nextjs':
            templateName = 'nextjs.Dockerfile';
            break;
        case 'vite-react':
        case 'cra':
        case 'vite':
            templateName = 'vite-react.Dockerfile';
            break;
        case 'static':
            templateName = 'static.Dockerfile';
            break;
        case 'node-generic':
        case 'node-backend':
            templateName = 'node-generic.Dockerfile';
            break;
        case 'generic-web':
            templateName = 'generic-web.Dockerfile';
            break;
        default:
            // Last resort: if there's a package.json, still try a generic web approach
            if (fs.existsSync(path.join(projectPath, 'package.json'))) {
                templateName = 'generic-web.Dockerfile';
            } else {
                return null;
            }
    }

    if (!templateName) {
        return null;
    }

    const templatePath = path.join(TEMPLATES_DIR, templateName);
    const targetDockerfile = path.join(projectPath, 'Dockerfile');

    try {
        fs.copyFileSync(templatePath, targetDockerfile);
        return targetDockerfile;
    } catch (err) {
        console.error('Failed to copy Dockerfile template:', err);
        return null;
    }
}

module.exports = {
    ensureDockerfile
};