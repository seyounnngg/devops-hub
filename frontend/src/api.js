const API_BASE = "https://api.hgu.app";

function getToken() {
  return localStorage.getItem("token");
}

// Global handler for when session is revoked from another device
let onSessionInvalidated = null;

export function setSessionInvalidatedHandler(handler) {
  onSessionInvalidated = handler;
}

async function handleResponse(res) {
  if (res.status === 401) {
    const text = await res.text().catch(() => '');
    // If it's because the session was invalidated elsewhere
    if (text.includes('SESSION_INVALIDATED') || text.includes('invalidated')) {
      if (onSessionInvalidated) onSessionInvalidated();
    }
    // Always clear token on 401 for authenticated routes
    localStorage.removeItem('token');
    throw new Error('Unauthorized');
  }
  return res;
}

export async function fetchWithAuth(url, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers
  });

  await handleResponse(res);
  return res;
}

export async function getProjects() {
  const res = await fetchWithAuth('/projects');
  return res.json();
}

export async function getRepositories() {
  const res = await fetchWithAuth('/repositories');
  return res.json();
}

export async function createProject(projectData) {
  const res = await fetchWithAuth('/projects', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(projectData),
  });
  return res.json();
}
