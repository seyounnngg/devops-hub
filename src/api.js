const API_BASE = import.meta.env.VITE_API_BASE || "https://api.hgu.app";

export { API_BASE };

// The session now lives in an httpOnly cookie set by the backend — this
// frontend code never reads or stores the token itself, so it can't be
// stolen via XSS and never appears in the URL or localStorage.

let onSessionInvalidated = null;

export function setSessionInvalidatedHandler(handler) {
  onSessionInvalidated = handler;
}

async function handleResponse(res) {
  if (res.status === 401) {
    if (onSessionInvalidated) onSessionInvalidated();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    // Surface a real error instead of letting callers treat an
    // { error: "..." } body as if it were the expected array/object shape.
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || body?.error || `Request failed (${res.status})`);
  }
  return res;
}

export async function fetchWithAuth(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    credentials: 'include',
  });
  await handleResponse(res);
  return res;
}

async function fetchJson(url, options) {
  const res = await fetchWithAuth(url, options);
  return res.json();
}

export function getMe() {
  return fetchJson('/me');
}

export function getProjects() {
  return fetchJson('/projects');
}

export function getRepositories() {
  return fetchJson('/repositories');
}

export function createProject(projectData) {
  return fetchJson('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(projectData),
  });
}

export function getDeployments({ limit, offset } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', limit);
  if (offset) params.set('offset', offset);
  const qs = params.toString();
  return fetchJson(`/deployments${qs ? `?${qs}` : ''}`);
}

export function getDeployment(id) {
  return fetchJson(`/deployments/${id}`);
}

export function getLogs(projectName) {
  return fetchJson(`/deployments/${encodeURIComponent(projectName)}/logs`);
}

export function stopDeployment(id) {
  return fetchJson(`/deployments/${id}/stop`, { method: 'POST' });
}

export function restartDeployment(id) {
  return fetchJson(`/deployments/${id}/restart`, { method: 'POST' });
}

export function deleteDeployment(id) {
  return fetchJson(`/deployments/${id}`, { method: 'DELETE' });
}

export function deleteAllMyData() {
  return fetchJson('/me', { method: 'DELETE' });
}

export async function logout() {
  try {
    await fetchWithAuth('/auth/logout', { method: 'POST' });
  } catch {
    // Ignore — we still navigate to the GitHub logout redirect below.
  }
}

export function apkDownloadUrl(deploymentId) {
  return `${API_BASE}/deployments/${deploymentId}/apk`;
}

export function githubLoginUrl(force = false) {
  return `${API_BASE}/auth/github${force ? '?force=true' : ''}`;
}

export function githubLogoutUrl() {
  return `${API_BASE}/auth/logout`;
}
