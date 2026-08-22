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

The code expects these columns:
- `deployments.service_type`
- `deployments.apk_url`
- `deployments.github_user_id` (BIGINT) — per-user isolation
- `user_sessions.github_access_token` — GitHub OAuth token, kept server-side only (see `utils/add_github_access_token_column.js`)
- `deployment_logs.github_user_id` — per-user log isolation (see `utils/add_github_user_id_to_deployment_logs.js`)
- `port_counter` — atomic external-port allocation (see `utils/create_port_counter_table.js`)
- `deployments.aab_url` — signed Android App Bundle path (see `utils/add_aab_url_column.js`)
- `apk_signing_keys` — per-project release keystore (see `utils/create_apk_signing_keys_table.js`)

Run the migration scripts in `utils/` once against the real DB (see each file's header comment for the exact command). These are ad-hoc, idempotent scripts, not a full migration framework — adopting one (Knex/Prisma Migrate) is a recommended follow-up, not done here.
