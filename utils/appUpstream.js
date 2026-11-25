/**
 * Where deployed web apps are published on the host, and where NPM reaches them.
 *
 * Deployed (user) containers run on Docker's default bridge — deliberately NOT on
 * devops-network, which holds MySQL and the docker-socket-proxy. Their port is
 * published only on the default bridge gateway (172.17.0.1), which exists only
 * inside this host: not reachable from the LAN or the internet. NPM (on
 * devops-network) proxies to that same address, so the domain is the only way in.
 *
 * Redeploy-in-place keeps working unchanged: each new container gets its own port
 * on this address, and the Proxy Host is switched to it once it is healthy.
 *
 * Override with APP_BIND_HOST if the default bridge uses a different gateway
 * (`docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}'`).
 */

const DEFAULT_APP_BIND_HOST = '172.17.0.1';
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function appBindHost(env = process.env) {
    const value = (env.APP_BIND_HOST || '').trim();
    if (!value) return DEFAULT_APP_BIND_HOST;
    if (!IPV4_RE.test(value)) {
        throw new Error(`APP_BIND_HOST must be an IPv4 address, got "${value}"`);
    }
    if (value === '0.0.0.0') {
        throw new Error('APP_BIND_HOST=0.0.0.0 would publish deployed apps on every interface');
    }
    return value;
}

/** Value for `docker run -p`: "<bind host>:<external>:<internal>". */
function publishSpec(externalPort, internalPort, env = process.env) {
    const ext = Number(externalPort);
    const int = Number(internalPort);
    for (const [label, port] of [['external', ext], ['internal', int]]) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error(`Invalid ${label} port: ${port}`);
        }
    }
    return `${appBindHost(env)}:${ext}:${int}`;
}

module.exports = { DEFAULT_APP_BIND_HOST, appBindHost, publishSpec };
