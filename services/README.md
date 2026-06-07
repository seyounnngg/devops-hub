# Deployment Services (Modular)

This folder contains the deployment logic split by service type, following the Requirement Engineering document priorities.

## Current Priorities (as decided)
- **Web** → Main focus. Make this as solid as possible.
- **APK** → Must be able to build simple Flutter / basic Android apps.
- **Function + Cron** → Simple/stub form is acceptable for now.

## Files
- `deploymentDispatcher.js` — Main router. All deployments go through here.
- `webDeployer.js` — Web service deployment (highest priority)
- `apkBuilder.js` — APK build logic (real build path prepared)
- `functionDeployer.js` — Serverless function (simple stub)
- `cronDeployer.js` — Cron job (simple stub)

## Important: Database Schema (per-user isolation - Plan B)

The code now expects these columns for full isolation:

- `service_type`
- `apk_url`
- `github_user_id` (BIGINT) ← NEW for Plan B

Run the migration script (recommended):

```bash
node utils/add_github_user_id_column.js
```

Manual SQL (if you prefer):

```sql
ALTER TABLE deployments 
  ADD COLUMN github_user_id BIGINT UNSIGNED NULL AFTER id;

ALTER TABLE deployments 
  ADD INDEX idx_github_user_id (github_user_id);
```

Old rows without `github_user_id` will be invisible to all users (clean isolation). New deployments are always owned by the logged-in GitHub user.

All queries + mutations now enforce ownership. Unauthenticated requests to data endpoints return 401.

## Next Steps (recommended order)
1. Run the ALTER TABLE above.
2. Test Web deployment still works.
3. Test creating an APK type deployment (even if it fails to produce artifact, the flow should be visible).
4. Improve Web deployer (better port handling, health checks, build logs streaming, etc.)
5. Make APK builder actually work for simple projects (proper Docker image + artifact copying).
