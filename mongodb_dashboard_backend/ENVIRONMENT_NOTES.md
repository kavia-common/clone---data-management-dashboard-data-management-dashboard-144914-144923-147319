# Backend runtime notes

- Backend binds to HOST 0.0.0.0 and PORT 3001 by default. You can override via environment variables.
- `npm run dev` runs only the Express backend via `node src/server.js`. It does not start the frontend and does not use any workspace commands.
- Swagger UI is mounted at `/docs` and `/api-docs`, with the OpenAPI spec at `/openapi.json`.
- Health endpoints:
  - `/health` (simple readiness; independent of DB)
  - `/api/health` (includes DB status)
- Frontend runs in its own container (port 3000). No backend scripts reference it.
