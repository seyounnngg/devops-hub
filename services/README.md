# Deployment Services (Modular)

This folder contains the deployment logic split by service type.

## Supported Service Types
- **Web** → Main focus. Clones a repo, builds/detects a Dockerfile, runs the container, health-checks it, and registers an Nginx Proxy Manager host.
  - If the repo has its own `Dockerfile`, that's used as-is — any language works.
  - Without one, `web/projectDetector.js` auto-generates a Dockerfile (`web/generateDockerfile.js` + `templates/`) for: Next.js, Vite/CRA/React, Node (Express/Fastify/Koa), plain static HTML, Python (Django / Flask / FastAPI / generic), Java (Maven or Gradle, incl. Spring Boot), and Go.
- **APK** → Builds Flutter, React Native, or plain Android (Gradle) projects. Produces a signed release
  `.apk` and `.aab`, both signed with a key generated once per (user, project) and reused on every later
  build of that project so Play Store update compatibility is preserved (`utils/signingKey.js`,
  `apk_signing_keys` table). React Native support is best-effort (installs Node + npm at build time to run
  the Metro bundler step; projects with unusual native dependencies may still fail).

Function and Cron service types were removed: they were stub implementations
(no resource limits, no real sandboxing beyond a bare container) that let any
authenticated user run arbitrary JS/shell on the host. If serverless
functions or scheduled jobs are needed again later, they should be rebuilt
with proper isolation (resource limits, execution timeouts, network egress
restrictions) rather than restored as-is.

## Files
- `deploymentDispatcher.js` — Main router. All deployments go through here.
- `webDeployer.js` — Web service deployment (highest priority)
- `apkBuilder.js` — Mobile app build logic (Flutter / React Native / Gradle)
- `utils/signingKey.js` — per-project release keystore generation/reuse
- `NpmProxyManager.js` — Nginx Proxy Manager integration (proxy hosts + optional Auto SSL)
- `web/projectDetector.js`, `web/generateDockerfile.js` — Dockerfile-less Web deploy auto-detection

## Database Schema

Schema changes live in `migrations/` (see `utils/migrate.js` — a small tracked runner, not a full
ORM-backed framework). Run `npm run migrate` against the real DB before deploying code that depends on a
new migration; `npm run migrate:status` lists applied vs. pending without changing anything.

Current schema additions beyond the original `deployments`/`user_sessions` tables:
- `deployments.service_type`, `deployments.github_user_id` (per-user isolation)
- `deployments.apk_url`, `deployments.aab_url` — signed mobile build artifacts
- `user_sessions.github_access_token` — GitHub OAuth token, kept server-side only
- `deployment_logs.github_user_id` — per-user log isolation
- `port_counter` — atomic external-port allocation
- `apk_signing_keys` — per-project release keystore
