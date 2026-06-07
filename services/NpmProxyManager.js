/**
 * NpmProxyManagerService
 * Reusable service for Nginx Proxy Manager integration (Proxy Hosts + optional Auto SSL).
 *
 * This is the ONLY file modified for NPM Proxy Host and SSL certificate automation.
 * All logic for creating proxy hosts and (when enabled) requesting/attaching
 * Let's Encrypt certificates lives here.
 *
 * Feature flag: AUTO_SSL_ENABLED (default false)
 *   - false: Only create Proxy Host (HTTP). No cert requests or SSL changes.
 *   - true: After successful Proxy Host creation, attempt LE cert + attach + enable Force SSL + HTTP/2.
 *
 * On any SSL failure: log warning only, keep HTTP URL, deployment continues.
 */

const axios = require('axios');

const DEFAULT_NPM_API_URL = 'http://27.35.113.108:81/api';
const DEFAULT_SERVER_HOST = '27.35.113.108';

function slugifyForDomain(name) {
  if (!name) return 'app';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63) || 'app';
}

async function getNpmToken(npmApiUrl, email, password) {
  const resp = await axios.post(`${npmApiUrl}/tokens`, {
    identity: email,
    secret: password
  }, {
    timeout: 8000,
    headers: { 'Content-Type': 'application/json' }
  });
  if (!resp.data || !resp.data.token) {
    throw new Error('No token returned from NPM');
  }
  return resp.data.token;
}

/**
 * Create Proxy Host (always attempted if port provided).
 * Then, if AUTO_SSL_ENABLED=true, attempt LE certificate + attach.
 *
 * Returns { success, url (http or https), proxyHostId?, certificateId?, error? }
 * Never throws for the SSL part — deployment must succeed.
 */
async function createProxyHost({ projectName, forwardPort, addLog = console.log }) {
  const npmApiUrl = process.env.NPM_API_URL || DEFAULT_NPM_API_URL;
  const npmEmail = process.env.NPM_EMAIL || '';
  const npmPassword = process.env.NPM_PASSWORD || '';
  const serverHost = process.env.SERVER_HOST || DEFAULT_SERVER_HOST;

  const autoSslEnabled = (process.env.AUTO_SSL_ENABLED || 'false').toLowerCase() === 'true';

  const domain = `${slugifyForDomain(projectName)}.hgu.app`;
  const httpUrl = `http://${serverHost}:${forwardPort}`;
  const httpsUrl = `https://${domain}`;

  if (!forwardPort || forwardPort < 1) {
    return { success: false, url: null, error: 'No forward port' };
  }

  if (!npmEmail || !npmPassword) {
    addLog('⚠️ [NPM] NPM_EMAIL / NPM_PASSWORD not configured. Skipping Proxy Host creation.');
    return { success: false, url: httpUrl, error: 'NPM credentials missing' };
  }

  let token;
  try {
    token = await getNpmToken(npmApiUrl, npmEmail, npmPassword);
  } catch (e) {
    addLog(`⚠️ [NPM] Failed to authenticate with NPM: ${e.message}`);
    return { success: false, url: httpUrl, error: e.message };
  }

  let proxyHostId;
  try {
    addLog(`🔗 [NPM] Creating Proxy Host ${domain} → ${serverHost}:${forwardPort}...`);

    const proxyPayload = {
      domain_names: [domain],
      forward_host: serverHost,
      forward_port: Number(forwardPort),
      forward_scheme: 'http',
      access_list_id: 0,
      certificate_id: 0,
      ssl_forced: false,
      caching_enabled: false,
      block_exploits: true,
      allow_websocket_upgrade: true,
      http2_support: false,
      enabled: true
    };

    const proxyResp = await axios.post(`${npmApiUrl}/nginx/proxy-hosts`, proxyPayload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });

    proxyHostId = proxyResp.data.id;
    addLog(`✅ [NPM] Proxy Host created (id: ${proxyHostId}).`);

  } catch (err) {
    const detail = err.response?.data?.error || err.message;
    addLog(`⚠️ [NPM] Proxy Host creation failed for ${domain}: ${detail}`);
    return { success: false, url: httpUrl, error: detail };
  }

  // === SSL / Certificate automation (only if flag enabled) ===
  let finalUrl = httpUrl;
  if (autoSslEnabled) {
    try {
      addLog(`🔐 [NPM SSL] AUTO_SSL_ENABLED=true. Requesting Let's Encrypt certificate for ${domain}...`);

      const certPayload = {
        provider: 'letsencrypt',
        domain_names: [domain],
        meta: {
          dns_challenge: false
        }
      };

      // Long timeout — LE issuance can take time
      const certResp = await axios.post(`${npmApiUrl}/nginx/certificates`, certPayload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 900000 // 15 minutes (matches NPM route timeout)
      });

      const certId = certResp.data.id;
      addLog(`✅ [NPM SSL] Certificate issued (id: ${certId}). Attaching to Proxy Host and enabling Force SSL + HTTP/2...`);

      const updatePayload = {
        certificate_id: certId,
        ssl_forced: true,
        http2_support: true
      };

      await axios.put(`${npmApiUrl}/nginx/proxy-hosts/${proxyHostId}`, updatePayload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 30000
      });

      addLog(`✅ [NPM SSL] SSL certificate attached. Force SSL and HTTP/2 enabled.`);
      finalUrl = httpsUrl;

    } catch (sslErr) {
      const detail = sslErr.response?.data?.error || sslErr.message || 'unknown SSL error';
      addLog(`⚠️ [NPM SSL] Failed to obtain or attach Let's Encrypt certificate for ${domain}: ${detail}`);
      addLog(`   Deployment succeeds with HTTP fallback URL (no SSL changes made).`);
      // finalUrl stays as httpUrl — no exception thrown
    }
  } else {
    addLog(`ℹ️ [NPM] AUTO_SSL_ENABLED=false (or not set). Skipping automatic Let's Encrypt certificate.`);
  }

  return {
    success: true,
    url: finalUrl,
    proxyHostId,
    // certificateId only present if SSL succeeded
    ...(finalUrl.startsWith('https') && { certificateAttached: true })
  };
}

module.exports = {
  createProxyHost,
  slugifyForDomain
};