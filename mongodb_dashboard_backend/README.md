# MongoDB Dashboard Backend

A minimal Express backend for the data management dashboard.

## Development

Start the server (binds to 0.0.0.0:3001 by default):
- npm run start    # production-like (node)
- npm run dev      # development (nodemon, auto-reload)
- npm run dev:node # development without nodemon (useful in CI)

Docs and health:
- Swagger UI:        GET /docs
- OpenAPI JSON:      GET /openapi.json
- Health (public):   GET /health
- Health (API):      GET /api/health

Notes:
- src/server.js defaults HOST=0.0.0.0 and PORT=3001 if not provided and logs readiness.
- Health endpoints do not require DB and always return 200 with basic status.
- The backend serves JSON responses only at root (/) to prevent frontend pages from appearing on backend preview.

## Environment

Copy .env.example to .env and set values as appropriate.

For MongoDB connectivity, set the following in your environment (do not commit secrets):
- MONGODB_URI=<your-connection-string>
- MONGODB_DB=<optional-db-name>

The server will still start without a database and report db=disconnected on /health. Database connection is attempted asynchronously and failures do not crash the server.
