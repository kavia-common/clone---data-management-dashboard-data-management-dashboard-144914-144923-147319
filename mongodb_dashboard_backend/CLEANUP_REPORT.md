# Backend Cleanup Report: chore/backend-clean-unused-files

This document summarizes the conservative cleanup performed on the Express backend. The goal was to remove truly unused files without impacting runtime behavior, imports, or build/docs generation.

Scope:
- Container: mongodb_dashboard_backend
- Strategy: static reachability analysis via imports/requires and known dynamic mounts; conservative deletions only.

Key dynamic entry points:
- src/server.js -> requires src/app.js
- src/app.js mounts routes directly using explicit require() calls
- Swagger spec generated from JSDoc in ./src/routes/*.js via swagger.js and generate_openapi.js
- No generic auto-loader using fs/glob patterns detected

Files confirmed in use:
- All files under:
  - src/routes/*.routes.js, src/routes/index.js
  - src/controllers/*.js (health, crudFactory, llmCosts*, etc.)
  - src/services/*.js (analytics, users, llmCostsHierarchy)
  - src/models/*.model.js
  - src/middleware/security.js, src/middleware/validators.js
  - src/utils/http.js, src/utils/validators.js
  - src/config/db.js
  - swagger.js, generate_openapi.js
  - scripts/list_all_data.js
  - interfaces/openapi.json (generated artifact used by CI/docs)

Files removed:
1) src/middleware/index.js
   - Reason: Scaffold placeholder not imported anywhere. No dynamic requires of middleware directory. Security and validators are imported directly by path.
   - Safety: Search confirmed no references.

2) src/routes/llmCosts.public.docs.js
   - Reason: Docs-only swagger JSDoc duplication of /api/llm-costs endpoints which are already fully documented inside src/routes/llmCosts.routes.js. The file is not required by app and not required by swagger.js because swagger.js scans only './src/routes/*.js'. Keeping this file causes duplicate/overlapping path docs; removing prevents confusion.
   - Safety: Not required for runtime (no router export used), not mounted by app.js, swagger uses annotations in llmCosts.routes.js.

Notes on what was NOT removed:
- README_BACKEND.md, ENVIRONMENT_NOTES.md, SCHEMA.md: project documentation
- eslint.config.js, nodemon.json: tooling
- swagger.js and generate_openapi.js: used by /docs and gen:openapi
- interfaces/openapi.json: generated artifact referenced by other tools
- scripts/list_all_data.js: operational script referenced in docs
- All routes, controllers, services, models currently referenced by app.js or by each other

Post-cleanup validations performed (static):
- Grep search for references to removed files: none
- Swagger annotations remain through primary routes files
- No index barrel or dynamic fs loader requiring removed files

Next steps for verification (runtime):
- Create branch and commit:
  git checkout -b chore/backend-clean-unused-files
  git add .
  git commit -m "chore(backend): remove unused scaffold and duplicate docs route; add cleanup report"

- Local validation:
  npm install
  npm run dev
  Visit:
    - /docs (Swagger renders without duplicate llm-costs entries)
    - /openapi.json
    - Exercise endpoints listed in README_BACKEND.md
