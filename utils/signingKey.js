/**
 * Per-project release signing key management.
 *
 * One keystore is generated per (github_user_id, project_name) the first
 * time it's needed, then reused for every later build of that project —
 * Play Store requires the same signing key across updates of an app.
 *
 * keytool/apksigner/jarsigner aren't installed in the backend's own
 * container — they live inside the Android/Flutter build image — so key
 * generation runs as its own short-lived `docker run` against that image.
 *
 * Passwords are stored in the DB and only ever handed to keytool/apksigner/
 * jarsigner via `-storepass:env` / `-keypass:env` / `--ks-pass env:...`
 * (an environment variable name, not the value itself) so they never
 * appear in argv or logs.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const BUILD_IMAGE = process.env.MOBILE_BUILD_IMAGE || 'ghcr.io/cirruslabs/flutter:stable';
const KEYSTORE_DIR = process.env.KEYSTORE_DIR || '/tmp/apk-keystores';

function slugify(name) {
    return (name || 'app')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 63) || 'app';
}

function randomPassword(len = 24) {
    return crypto.randomBytes(len).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, len);
}

async function generateKeystore({ keystorePath, alias, storePassword, keyPassword }) {
    const keystoreFile = path.basename(keystorePath);

    await execFileAsync('docker', [
        'run', '--rm',
        '-v', `${KEYSTORE_DIR}:/keystores`,
        '-e', 'KS_STORE_PW',
        '-e', 'KS_KEY_PW',
        BUILD_IMAGE,
        'keytool', '-genkeypair',
        '-keystore', `/keystores/${keystoreFile}`,
        '-alias', alias,
        '-keyalg', 'RSA',
        '-keysize', '2048',
        '-validity', '10000',
        '-storepass:env', 'KS_STORE_PW',
        '-keypass:env', 'KS_KEY_PW',
        '-dname', `CN=${alias}, OU=DevOpsHub, O=Handong DevOps Hub, L=Pohang, ST=Gyeongbuk, C=KR`
    ], {
        env: { ...process.env, KS_STORE_PW: storePassword, KS_KEY_PW: keyPassword },
        timeout: 60000
    });
}

/** Returns { keystorePath, alias, storePassword, keyPassword, reused } */
async function getOrCreateSigningKey(pool, { githubUserId, projectName }) {
    const [rows] = await pool.execute(
        'SELECT * FROM apk_signing_keys WHERE github_user_id = ? AND project_name = ? LIMIT 1',
        [githubUserId, projectName]
    );

    if (rows.length > 0 && fs.existsSync(rows[0].keystore_path)) {
        const row = rows[0];
        return {
            keystorePath: row.keystore_path,
            alias: row.key_alias,
            storePassword: row.store_password,
            keyPassword: row.key_password,
            reused: true
        };
    }

    if (!fs.existsSync(KEYSTORE_DIR)) fs.mkdirSync(KEYSTORE_DIR, { recursive: true });

    const alias = `key-${slugify(projectName)}`;
    // Must be the same value: keytool's default keystore type (PKCS12 since
    // JDK 9) effectively only honors one password per store — asking for a
    // different key password fails at sign time with a decryption error
    // ("Given final block not properly padded"), not at generation time.
    const storePassword = randomPassword();
    const keyPassword = storePassword;
    const keystorePath = path.join(KEYSTORE_DIR, `${githubUserId}-${slugify(projectName)}.jks`);

    await generateKeystore({ keystorePath, alias, storePassword, keyPassword });

    try {
        await pool.execute(
            `INSERT INTO apk_signing_keys (github_user_id, project_name, keystore_path, key_alias, store_password, key_password)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [githubUserId, projectName, keystorePath, alias, storePassword, keyPassword]
        );
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            // Lost a race with a concurrent build of the same project — use the winner's key instead.
            try { fs.unlinkSync(keystorePath); } catch (_) {}
            const [existing] = await pool.execute(
                'SELECT * FROM apk_signing_keys WHERE github_user_id = ? AND project_name = ? LIMIT 1',
                [githubUserId, projectName]
            );
            const row = existing[0];
            return {
                keystorePath: row.keystore_path,
                alias: row.key_alias,
                storePassword: row.store_password,
                keyPassword: row.key_password,
                reused: true
            };
        }
        throw err;
    }

    return { keystorePath, alias, storePassword, keyPassword, reused: false };
}

module.exports = { getOrCreateSigningKey, BUILD_IMAGE, KEYSTORE_DIR };
