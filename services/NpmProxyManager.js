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
const { appBindHost } = require('../utils/appUpstream');

// NPM_API_URL must come from the environment. Proxy Hosts forward to the
// host-internal address deployed apps are published on (utils/appUpstream.js),
// never to the public IP — that used to require the router's DMZ.

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
  const npmApiUrl = process.env.NPM_API_URL || '';
  const npmEmail = process.env.NPM_EMAIL || '';
  const npmPassword = process.env.NPM_PASSWORD || '';
  const upstreamHost = appBindHost();

  const autoSslEnabled = (process.env.AUTO_SSL_ENABLED || 'false').toLowerCase() === 'true';

  const domain = `${slugifyForDomain(projectName)}.hgu.app`;
  // Apps are not reachable on a host port from outside any more, so there is no
  // port-URL fallback: without a Proxy Host the app is not reachable.
  const httpUrl = null;
  const httpsUrl = `https://${domain}`;

  if (!forwardPort || forwardPort < 1) {
    return { success: false, url: null, error: 'No forward port' };
  }

  if (!npmApiUrl) {
    addLog('⚠️ [NPM] NPM_API_URL not configured. Skipping Proxy Host creation.');
    return { success: false, url: httpUrl, error: 'NPM endpoint not configured' };
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
    addLog(`🔗 [NPM] Creating Proxy Host ${domain} → ${upstreamHost}:${forwardPort}...`);

    const proxyPayload = {
      domain_names: [domain],
      forward_host: upstreamHost,
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
    const detail = err.response?.data ? JSON.stringify(err.response.data) : (err.message || 'unknown error');
    addLog(`⚠️ [NPM] Proxy Host creation failed for ${domain}: ${detail}`);
    return { success: false, url: httpUrl, error: detail };
  }

  // After successful proxy host creation, prefer the subdomain URL.
  // http://<domain> (via the registered proxy host) by default;
  // upgraded to https://<domain> only if AUTO_SSL succeeds.
  let finalUrl = `http://${domain}`;
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
      const detail = sslErr.response?.data ? JSON.stringify(sslErr.response.data) : (sslErr.message || 'unknown SSL error');
      addLog(`⚠️ [NPM SSL] Failed to obtain or attach Let's Encrypt certificate for ${domain}: ${detail}`);
      addLog(`   Deployment succeeds with HTTP fallback URL (no SSL changes made).`);
      // finalUrl stays as http subdomain
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

// NPM objects that can reference a certificate. If any of them still uses it,
// the certificate is kept.
const CERT_USER_ENDPOINTS = ['proxy-hosts', 'redirection-hosts', 'dead-hosts', 'streams'];

/**
 * K14: is certificate `certId` still referenced by any NPM host/stream?
 * Returns { inUse: boolean, by?: string } or throws if usage can't be determined
 * (then the caller must NOT delete the certificate).
 */
async function findCertificateUsers(npmApiUrl, token, certId) {
  for (const kind of CERT_USER_ENDPOINTS) {
    const resp = await axios.get(`${npmApiUrl}/nginx/${kind}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000
    });
    const user = (resp.data || []).find(item => item && Number(item.certificate_id) === Number(certId));
    if (user) {
      return { inUse: true, by: `${kind} #${user.id}${user.domain_names ? ` (${user.domain_names.join(', ')})` : ''}` };
    }
  }
  return { inUse: false };
}

/**
 * Delete the Proxy Host for the given project name (if it exists), and then —
 * K14 — the certificate it used, if nothing else uses that certificate any more
 * (AUTO_SSL issues one certificate per project; it used to be left behind and
 * keep renewing). Reuses the same token acquisition and slugify logic as
 * createProxyHost().
 *
 * Never throws: the project deletion must succeed even if NPM cleanup fails.
 * Returns { proxyDeleted, certificateId, certificateDeleted, certificateKeptReason }.
 */
async function deleteProxyHost({ projectName, addLog = console.log }) {
  const npmApiUrl = process.env.NPM_API_URL || '';
  const npmEmail = process.env.NPM_EMAIL || '';
  const npmPassword = process.env.NPM_PASSWORD || '';

  const domain = `${slugifyForDomain(projectName)}.hgu.app`;
  const result = { proxyDeleted: false, certificateId: null, certificateDeleted: false, certificateKeptReason: null };

  if (!npmApiUrl) {
    addLog('⚠️ [NPM] NPM_API_URL not configured. Skipping Proxy Host deletion.');
    return result;
  }

  if (!npmEmail || !npmPassword) {
    addLog('⚠️ [NPM] NPM_EMAIL / NPM_PASSWORD not configured. Skipping Proxy Host deletion.');
    return result;
  }

  let token;
  try {
    token = await getNpmToken(npmApiUrl, npmEmail, npmPassword);
  } catch (e) {
    addLog(`⚠️ [NPM] Failed to authenticate with NPM for deletion: ${e.message}`);
    return result;
  }

  try {
    const listResp = await axios.get(`${npmApiUrl}/nginx/proxy-hosts`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000
    });

    const match = (listResp.data || []).find(p =>
      p && p.domain_names && p.domain_names.includes(domain)
    );

    if (match && match.id) {
      // Read the certificate id *before* deleting — afterwards it can't be looked up.
      const certId = Number(match.certificate_id) > 0 ? Number(match.certificate_id) : null;
      result.certificateId = certId;

      await axios.delete(`${npmApiUrl}/nginx/proxy-hosts/${match.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000
      });
      result.proxyDeleted = true;
      addLog(`✅ [NPM] Deleted Proxy Host for ${domain} (id: ${match.id})`);
    } else {
      addLog(`ℹ️ [NPM] No Proxy Host found for ${domain} (nothing to delete)`);
      return result;
    }
  } catch (err) {
    const detail = err.response?.data?.error || err.message || 'unknown error';
    addLog(`⚠️ [NPM] Failed to delete Proxy Host for ${domain}: ${detail}. Deletion will continue.`);
    // Do not throw - deletion must succeed. Certificate is left alone (proxy may still use it).
    return result;
  }

  if (!result.certificateId) return result;

  const certId = result.certificateId;
  try {
    const usage = await findCertificateUsers(npmApiUrl, token, certId);
    if (usage.inUse) {
      result.certificateKeptReason = `still used by ${usage.by}`;
      addLog(`ℹ️ [NPM] Keeping certificate #${certId}: ${result.certificateKeptReason}.`);
      return result;
    }
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.response?.data?.error || err.message || 'unknown error';
    result.certificateKeptReason = `could not check whether it is still used (${detail})`;
    addLog(`⚠️ [NPM] Keeping certificate #${certId}: ${result.certificateKeptReason}. Remove it in NPM if it is unused.`);
    return result;
  }

  try {
    await axios.delete(`${npmApiUrl}/nginx/certificates/${certId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000
    });
    result.certificateDeleted = true;
    addLog(`✅ [NPM] Deleted certificate #${certId} (no longer used).`);
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.response?.data?.error || err.message || 'unknown error';
    result.certificateKeptReason = `delete failed (${detail})`;
    addLog(`⚠️ [NPM] Could not delete certificate #${certId}: ${detail}. Project deletion continues; remove it in NPM.`);
  }
  return result;
}

/**
 * Repoint an existing Proxy Host at a new forward_port (and forward_host, so
 * Proxy Hosts created when they pointed at the public IP are migrated on their
 * next redeploy/rollback) — used by
 * redeploy-in-place (webDeployer.js): the new container is built, started,
 * and health-checked on its own port first, then traffic is switched to it
 * here, and only *after* that does the caller stop the old container. No
 * window where the domain points at nothing.
 *
 * Returns { success, error? }. Never throws.
 */
async function updateProxyHost({ projectName, forwardPort, addLog = console.log }) {
  const npmApiUrl = process.env.NPM_API_URL || '';
  const npmEmail = process.env.NPM_EMAIL || '';
  const npmPassword = process.env.NPM_PASSWORD || '';

  const domain = `${slugifyForDomain(projectName)}.hgu.app`;

  if (!npmApiUrl || !npmEmail || !npmPassword) {
    return { success: false, error: 'NPM not configured' };
  }

  try {
    const token = await getNpmToken(npmApiUrl, npmEmail, npmPassword);
    const listResp = await axios.get(`${npmApiUrl}/nginx/proxy-hosts`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000
    });
    const match = (listResp.data || []).find(p => p && p.domain_names && p.domain_names.includes(domain));
    if (!match) {
      return { success: false, error: `No Proxy Host found for ${domain}` };
    }

    const upstreamHost = appBindHost();
    await axios.put(`${npmApiUrl}/nginx/proxy-hosts/${match.id}`, { forward_host: upstreamHost, forward_port: Number(forwardPort) }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });
    addLog(`✅ [NPM] ${domain} now points at ${upstreamHost}:${forwardPort}.`);
    return { success: true };
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : (err.message || 'unknown error');
    return { success: false, error: detail };
  }
}

/**
 * Add a custom domain to a project's existing Proxy Host (found by its
 * default <slug>.hgu.app domain). If AUTO_SSL_ENABLED, requests a single
 * certificate covering both the default and custom domain together (a
 * separate cert covering only the custom domain would replace the proxy
 * host's certificate and break TLS on the default hgu.app subdomain).
 *
 * Returns { success, url?, error? }. Never throws.
 */
async function addCustomDomain({ projectName, customDomain, forwardPort, addLog = console.log }) {
  const npmApiUrl = process.env.NPM_API_URL || '';
  const npmEmail = process.env.NPM_EMAIL || '';
  const npmPassword = process.env.NPM_PASSWORD || '';
  const autoSslEnabled = (process.env.AUTO_SSL_ENABLED || 'false').toLowerCase() === 'true';

  const defaultDomain = `${slugifyForDomain(projectName)}.hgu.app`;

  if (!npmApiUrl || !npmEmail || !npmPassword) {
    return { success: false, error: 'NPM not configured on this server' };
  }

  let token;
  try {
    token = await getNpmToken(npmApiUrl, npmEmail, npmPassword);
  } catch (e) {
    return { success: false, error: `NPM auth failed: ${e.message}` };
  }

  let match;
  try {
    const listResp = await axios.get(`${npmApiUrl}/nginx/proxy-hosts`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000
    });
    match = (listResp.data || []).find(p => p && p.domain_names && p.domain_names.includes(defaultDomain));
  } catch (e) {
    return { success: false, error: `Could not look up existing Proxy Host: ${e.message}` };
  }

  if (!match) {
    return { success: false, error: `No existing Proxy Host found for ${defaultDomain}. Deploy the project first.` };
  }

  const updatedDomains = Array.from(new Set([...(match.domain_names || []), customDomain]));

  try {
    await axios.put(`${npmApiUrl}/nginx/proxy-hosts/${match.id}`, { domain_names: updatedDomains }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });
    addLog(`✅ [NPM] ${customDomain} added to the Proxy Host for ${defaultDomain}.`);
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : (err.message || 'unknown error');
    return { success: false, error: detail };
  }

  let url = `http://${customDomain}`;
  if (autoSslEnabled) {
    try {
      addLog(`🔐 [NPM SSL] Requesting a certificate covering ${updatedDomains.join(', ')}...`);
      const certResp = await axios.post(`${npmApiUrl}/nginx/certificates`, {
        provider: 'letsencrypt',
        domain_names: updatedDomains,
        meta: { dns_challenge: false }
      }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 900000
      });

      await axios.put(`${npmApiUrl}/nginx/proxy-hosts/${match.id}`, {
        domain_names: updatedDomains,
        certificate_id: certResp.data.id,
        ssl_forced: true,
        http2_support: true
      }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 30000
      });

      addLog(`✅ [NPM SSL] Certificate issued and attached for ${customDomain}.`);
      url = `https://${customDomain}`;
    } catch (sslErr) {
      const detail = sslErr.response?.data ? JSON.stringify(sslErr.response.data) : (sslErr.message || 'unknown SSL error');
      addLog(`⚠️ [NPM SSL] Failed to obtain/attach certificate for ${customDomain}: ${detail}`);
      addLog('   Domain is routed over HTTP only. Make sure its DNS points to this server, then try again.');
    }
  }

  return { success: true, url };
}

/**
 * Remove a custom domain from a project's Proxy Host, leaving the default
 * <slug>.hgu.app domain untouched. Never throws.
 */
async function removeCustomDomain({ projectName, customDomain, addLog = console.log }) {
  const npmApiUrl = process.env.NPM_API_URL || '';
  const npmEmail = process.env.NPM_EMAIL || '';
  const npmPassword = process.env.NPM_PASSWORD || '';

  const defaultDomain = `${slugifyForDomain(projectName)}.hgu.app`;

  if (!npmApiUrl || !npmEmail || !npmPassword) {
    addLog('⚠️ [NPM] NPM not configured. Skipping custom domain removal on the proxy side.');
    return { success: false };
  }

  try {
    const token = await getNpmToken(npmApiUrl, npmEmail, npmPassword);
    const listResp = await axios.get(`${npmApiUrl}/nginx/proxy-hosts`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000
    });
    const match = (listResp.data || []).find(p => p && p.domain_names && p.domain_names.includes(defaultDomain));
    if (!match) {
      addLog(`ℹ️ [NPM] No Proxy Host found for ${defaultDomain}.`);
      return { success: true };
    }

    const remainingDomains = (match.domain_names || []).filter(d => d !== customDomain);
    await axios.put(`${npmApiUrl}/nginx/proxy-hosts/${match.id}`, { domain_names: remainingDomains }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });
    addLog(`✅ [NPM] ${customDomain} removed from the Proxy Host for ${defaultDomain}.`);
    return { success: true };
  } catch (err) {
    const detail = err.response?.data?.error || err.message || 'unknown error';
    addLog(`⚠️ [NPM] Failed to remove ${customDomain}: ${detail}`);
    return { success: false };
  }
}

module.exports = {
  createProxyHost,
  deleteProxyHost,
  updateProxyHost,
  addCustomDomain,
  removeCustomDomain,
  slugifyForDomain
};