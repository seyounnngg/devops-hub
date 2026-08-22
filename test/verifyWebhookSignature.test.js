const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyWebhookSignature } = require('../utils/verifyWebhookSignature');

function sign(body, secret) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

test('accepts a correctly signed payload', () => {
    const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));
    const secret = 'test-secret';
    const ok = verifyWebhookSignature({ rawBody: body, signatureHeader: sign(body, secret), secret });
    assert.equal(ok, true);
});

test('rejects a payload signed with the wrong secret', () => {
    const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));
    const ok = verifyWebhookSignature({ rawBody: body, signatureHeader: sign(body, 'wrong-secret'), secret: 'test-secret' });
    assert.equal(ok, false);
});

test('rejects a tampered body even with a validly-formatted signature', () => {
    const original = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));
    const secret = 'test-secret';
    const signature = sign(original, secret);
    const tampered = Buffer.from(JSON.stringify({ ref: 'refs/heads/malicious-branch' }));
    const ok = verifyWebhookSignature({ rawBody: tampered, signatureHeader: signature, secret });
    assert.equal(ok, false);
});

test('rejects when any input is missing', () => {
    const body = Buffer.from('{}');
    assert.equal(verifyWebhookSignature({ rawBody: null, signatureHeader: 'sha256=abc', secret: 's' }), false);
    assert.equal(verifyWebhookSignature({ rawBody: body, signatureHeader: null, secret: 's' }), false);
    assert.equal(verifyWebhookSignature({ rawBody: body, signatureHeader: 'sha256=abc', secret: null }), false);
});
