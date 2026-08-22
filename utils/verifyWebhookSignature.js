const crypto = require('crypto');

/**
 * Verifies a GitHub webhook's X-Hub-Signature-256 header against the raw
 * request body bytes and the per-deployment secret. Constant-time compare
 * so response timing can't be used to guess the signature byte-by-byte.
 */
function verifyWebhookSignature({ rawBody, signatureHeader, secret }) {
    if (!rawBody || !signatureHeader || !secret) return false;

    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const providedBuf = Buffer.from(signatureHeader);
    const expectedBuf = Buffer.from(expected);

    if (providedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

module.exports = { verifyWebhookSignature };
