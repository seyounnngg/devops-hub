const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectProjectType } = require('../services/web/projectDetector');

const fixturesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projectdetector-test-'));

after(() => {
    fs.rmSync(fixturesRoot, { recursive: true, force: true });
});

function makeFixture(name, files) {
    const dir = path.join(fixturesRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [relPath, content] of Object.entries(files)) {
        const full = path.join(dir, relPath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
    }
    return dir;
}

test('detects Django via manage.py', () => {
    const dir = makeFixture('django', { 'manage.py': '', 'requirements.txt': 'Django==5.0' });
    assert.deepEqual(detectProjectType(dir), { type: 'python-django', framework: 'django' });
});

test('detects Flask via requirements.txt content', () => {
    const dir = makeFixture('flask', { 'requirements.txt': 'flask==3.0', 'app.py': "print('app')" });
    assert.deepEqual(detectProjectType(dir), { type: 'python-flask', framework: 'flask' });
});

test('detects FastAPI via requirements.txt content', () => {
    const dir = makeFixture('fastapi', { 'requirements.txt': 'fastapi\nuvicorn' });
    assert.deepEqual(detectProjectType(dir), { type: 'python-fastapi', framework: 'fastapi' });
});

test('falls back to generic Python when no framework is recognized', () => {
    const dir = makeFixture('pygeneric', { 'requirements.txt': 'requests' });
    assert.deepEqual(detectProjectType(dir), { type: 'python-generic', framework: 'generic' });
});

test('detects Java Maven via pom.xml', () => {
    const dir = makeFixture('maven', { 'pom.xml': '<project></project>' });
    assert.deepEqual(detectProjectType(dir), { type: 'java-maven', framework: 'java' });
});

test('detects Java Gradle via build.gradle', () => {
    const dir = makeFixture('gradle', { 'build.gradle': 'plugins {}' });
    assert.deepEqual(detectProjectType(dir), { type: 'java-gradle', framework: 'java' });
});

test('detects Go via go.mod', () => {
    const dir = makeFixture('go', { 'go.mod': 'module example.com/app\n\ngo 1.23' });
    assert.deepEqual(detectProjectType(dir), { type: 'go', framework: 'go' });
});

test('still detects Next.js (existing JS cascade unaffected by new checks)', () => {
    const dir = makeFixture('nextjs', {
        'package.json': JSON.stringify({ dependencies: { next: '^14.0.0', react: '^18.0.0' } })
    });
    assert.deepEqual(detectProjectType(dir), { type: 'nextjs', framework: 'next.js' });
});

test('falls back to unknown with no recognizable markers', () => {
    const dir = makeFixture('empty', { 'README.md': 'hello' });
    assert.deepEqual(detectProjectType(dir), { type: 'unknown', framework: null });
});
