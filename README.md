# MongoDB Dashboard Backend (Express + MongoDB)

## Project overview

This repository contains the backend API for the Data Management Dashboard. It is an Express.js application with a MongoDB (Mongoose) data layer, a documented REST API (Swagger/OpenAPI), and a multi-tenant scoping approach (tenant resolved from JWT when present, or from headers/query aliases in “demo/testing” mode).

The API supports dashboard and analytics workflows such as users, tenants, session tracking, application deployments, and LLM cost reporting.

## Tech stack and prerequisites

This project is implemented in Node.js and uses Express for HTTP routing, Mongoose for MongoDB access, and Jest/Supertest for testing.

You will need the following tools installed locally:

- Node.js (the Dockerfile uses Node 18 LTS)
- npm
- A MongoDB instance (local or hosted) if you want database-backed endpoints to fully function

## Getting started

### 1) Setup and installation

From this repository root:

```bash
cd mongodb_dashboard_backend
npm install
```

### 2) Environment variables

Create a `.env` file in `mongodb_dashboard_backend/` (do not commit secrets). This repo includes guidance in `mongodb_dashboard_backend/ENVIRONMENT_NOTES.md`.

Common variables you may need:

- `HOST` (default behavior binds to `0.0.0.0` in many environments)
- `PORT` (default: `3001`)
- `MONGODB_URI` (Mongo connection string)
- `MONGODB_DB` (database name)

Optional tuning and diagnostics variables (see notes for details):

- `DISABLE_WATCH=1`
- `NODE_OPTIONS="--max-old-space-size=512"`
- `DEBUG_LLMCOSTS_EXPLAIN=1`
- `LLM_COSTS_ROUTE_TIMEOUT_MS=12000`
- `DEFAULT_PAGE_LIMIT=20`

TODO: Add a `.env.example` file if you want a canonical template for contributors.

### 3) Run locally

From `mongodb_dashboard_backend/`:

```bash
npm run dev
```

The server defaults to port `3001`.

### 4) Quick verification / health checks

These endpoints should return quickly:

- `GET /health` (aliases include `/ready`, `/healthz`, `/live` depending on configuration)
- `GET /api/health` (includes DB connection state)
- Swagger UI: `GET /api/docs` (aliases: `/api-docs`, `/docs`)
- OpenAPI JSON: `GET /api/docs.json` (aliases: `/openapi.json`, `/api-docs.json`)

Example:

```bash
curl -sSf http://localhost:3001/health
curl -sSf http://localhost:3001/api/health
```

## Scripts / commands

All commands below are run from `mongodb_dashboard_backend/`:

- `npm run start`  
  Starts the server (production-style) using `node src/server.js`.

- `npm run dev`  
  Starts the server in development mode (`NODE_ENV=development node src/server.js`).

- `npm run dev:nodemon`  
  Starts with `nodemon` for hot reload during local development.

- `npm run test`  
  Runs Jest tests.

- `npm run lint`  
  Runs ESLint across the repository.

- `npm run docs`  
  Prints quick pointers for Swagger/OpenAPI URLs.

- `npm run health`  
  Performs a curl health check against `http://127.0.0.1:${PORT:-3001}/health`.

- `npm run gen:openapi`  
  Runs the OpenAPI generator script (if present and configured).

## Testing

This repository uses Jest.

From `mongodb_dashboard_backend/`:

```bash
npm test
```

TODO: If CI requires a running MongoDB for integration tests, document the recommended approach (e.g., Docker-based MongoDB for tests).

## Build and deployment

### Docker

A Dockerfile is included at `mongodb_dashboard_backend/Dockerfile`. It builds a Node 18 Alpine image and runs `node src/server.js`.

Typical flow (example; adjust paths to match your workspace layout):

```bash
docker build -t mongodb-dashboard-backend -f mongodb_dashboard_backend/Dockerfile .
docker run --rm -p 3001:3001 --env-file mongodb_dashboard_backend/.env mongodb-dashboard-backend
```

### Production considerations

This repository includes several “stability and performance” environment flags documented in `ENVIRONMENT_NOTES.md` (memory caps, route caching, compression, and diagnostics for performance troubleshooting). For production deployments you should:

- Provide valid MongoDB configuration (`MONGODB_URI`, `MONGODB_DB`)
- Configure CORS appropriately for your frontend origin(s)
- Avoid enabling “open CORS” flags except for development
- Treat authentication and tenant-scoping carefully (JWT-based tenant enforcement is supported)

TODO: Add a formal deployment guide for your target platform (Kubernetes, ECS, Heroku, etc.) if needed.

## Project structure

At a high level:

- `mongodb_dashboard_backend/src/` contains the application code.
  - `src/server.js` is the primary entrypoint (as referenced by package.json).
  - `src/app.js` contains the Express app wiring.
  - `src/routes/` defines API route modules.
  - `src/controllers/` contains route handlers / controllers.
  - `src/models/` contains Mongoose models.
  - `src/services/` contains business logic and service modules.
  - `src/middleware/` contains middleware (auth, tenant scoping, validation, security).
  - `src/utils/` contains shared utilities and test helpers.
- `mongodb_dashboard_backend/interfaces/openapi.json` contains the OpenAPI specification snapshot used for documentation and integration.

## Contributing

Contributions are welcome.

Please keep changes focused and include tests where applicable. Before opening a PR:

1. Run `npm test` from `mongodb_dashboard_backend/`.
2. Run `npm run lint` from `mongodb_dashboard_backend/`.
3. Update or add documentation if you change API behavior.

TODO: Add a CODEOWNERS file or a more detailed contribution workflow if this project will be maintained by multiple teams.

## License

TODO: Add the project license. If unknown, keep this placeholder until confirmed.

## Contact / maintainers

TODO: Add maintainers and a preferred contact method.

If you do not know who owns this repository, start by contacting the team responsible for the Data Management Dashboard backend API.
