/**
 * GitHub repo webhook management for auto-redeploy on push.
 *
 * The OAuth `repo` scope already requested at login covers full control of
 * repository webhooks (`admin:repo_hook` is a subset of `repo`), so no
 * additional GitHub App permission is needed.
 */
const axios = require('axios');

async function registerWebhook({ githubToken, githubUsername, repository, secret, callbackUrl }) {
    try {
        const resp = await axios.post(
            `https://api.github.com/repos/${githubUsername}/${repository}/hooks`,
            {
                name: 'web',
                active: true,
                events: ['push'],
                config: { url: callbackUrl, content_type: 'json', secret }
            },
            {
                headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' },
                timeout: 15000
            }
        );
        return { success: true, webhookId: resp.data.id };
    } catch (err) {
        return { success: false, error: err.response?.data?.message || err.message };
    }
}

async function deleteWebhook({ githubToken, githubUsername, repository, webhookId }) {
    if (!webhookId) return;
    try {
        await axios.delete(
            `https://api.github.com/repos/${githubUsername}/${repository}/hooks/${webhookId}`,
            {
                headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' },
                timeout: 15000
            }
        );
    } catch (err) {
        // Non-fatal: the repo/hook may already be gone, or the token may have been revoked.
        console.error('Failed to delete GitHub webhook (non-fatal):', err.response?.data?.message || err.message);
    }
}

module.exports = { registerWebhook, deleteWebhook };
