# Backend Dev Run Notes

- This container is an Express-only backend. It does NOT run any React dev server.
- Use these scripts:
  - npm run dev        -> nodemon + NODE_OPTIONS=--max_old_space_size=512
  - npm run dev:express -> plain node run (no file watching)
  - npm start          -> production-like run (plain node)
- Crash guards:
  - server.js logs unhandledRejection/uncaughtException and keeps the process alive in development.
  - In production, the process sets exitCode=1 so orchestrators can restart the service.
- Memory guard:
  - NODE_OPTIONS=--max_old_space_size=512 is set in scripts; increase to 1024 if needed for large datasets.
- /api/llm-costs:
  - Implements fast ListEnvelope response whenever ?page and ?limit are used.
  - Supports optional exact match filter by organization_id.
  - Returns { success, data, meta{ page, limit, total } }.
