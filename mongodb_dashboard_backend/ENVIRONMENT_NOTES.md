# Backend Runtime Stabilization Notes

- Pure Express server: This backend does not start any React or webpack dev server. Scripts run Node on src/server.js only.
- Memory cap: Scripts set NODE_OPTIONS="--max-old-space-size=256". Unsupported flags like --enable-source-maps=false or harmony flags have been removed from NODE_OPTIONS and node args.
- Nodemon: Now watches only server sources (src, swagger.js) and ignores heavy directories (node_modules, build, coverage, interfaces, kavia-docs, tests).
- Guarded debug: To emit a single, one-time debug dump for /api/llm-costs user enrichment, set BACKEND_DEBUG_ONCE=true in the environment.
  This prints sample users entries and a few candidate IDs to the console once per process.
- Validation: Hit GET /api/llm-costs with a known tenant (x-organization-id or JWT). The response should include:
  - X-Users-Enriched: "<matched>/<requested>"
  - X-Users-Match-Field: "<field used in users collection>"
  - X-Users-Sample-Ids: "<first few ids>"
  Users entries should have users[i].user populated when a match exists; null otherwise.
