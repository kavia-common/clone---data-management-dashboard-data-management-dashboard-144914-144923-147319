<<<<<<< HEAD
=======
# Dashboard Backend (Express + MongoDB)

This backend provides RESTful APIs for dashboard collections (public access; no authentication) and health checks.

Key features:
- Express.js with Helmet, CORS, Rate Limiting
- MongoDB via Mongoose with indexes per schema guidance
- Public CRUD for:
  - users
  - session_tracking
  - app_deployments
  - sample (demo)
- Swagger docs at /docs with dynamic server URL

## Setup

1) Configure environment
- A `.env.example` is provided. Copy it to `.env` (or set environment variables in your runtime):
  ```
  cp .env.example .env
  ```
- By default, the server listens on `PORT=3001`. Adjust if needed.

2) Configure MongoDB
- The service reads the MongoDB connection string from the environment variable:
  - `MONGODB_URI`
- You can optionally force the database name by setting:
  - `MONGODB_DB` (e.g., develop_kaviaroot / qa_kaviaroot / pre_prod__kaviaroot)
- Automatic index creation is disabled by default to avoid failures on existing datasets.
  - To enable, set: `MONGOOSE_AUTO_INDEX=true`
- If `MONGODB_URI` is not set, the service will use a built-in development default.
  - For production, ALWAYS set `MONGODB_URI`.
- To override or ensure explicit configuration, set:
  ```
  MONGODB_URI=<your-mongodb-uri>
  MONGODB_DB=<your-db-name> # optional but recommended
  MONGOOSE_AUTO_INDEX=true   # optional
  ```

3) Configure CORS
- The backend includes a robust CORS middleware that:
  - In development (NODE_ENV != production) or when `CORS_ALLOW_ALL=true`, allows any origin by default (credentials per `CORS_CREDENTIALS`).
  - In production, reads allowed origins from:
    - `CORS_ORIGIN` (single origin) and/or
    - `CORS_ORIGINS` (comma-separated list)
    - `FRONTEND_ORIGIN` (convenience single origin)
  - Optionally derives an allowed origin from:
    - `REACT_APP_API_BASE_URL` (commonly set in the frontend); it also auto-adds common dev ports.
  - Adds sensible defaults for local dev: `http://localhost:3000`, `https://localhost:3000`.
  - Honors `CORS_CREDENTIALS=true` to enable credentialed requests.

- Local development (recommended):
  - Backend on 3001, frontend on 3000.
  - Frontend should set:
    ```
    REACT_APP_API_BASE_URL=http://localhost:3001
    REACT_APP_API_PREFIX=/api
    ```
  - Backend allows all origins by default in dev; no extra CORS config required.

- Typical production configurations:
  - Single origin:
    ```
    CORS_ORIGIN=https://app.example.com
    ```
  - Multiple origins:
    ```
    CORS_ORIGINS=https://app.example.com,https://admin.example.com
    ```
  - Derive from frontend API base:
    ```
    REACT_APP_API_BASE_URL=https://api.example.com/api
    ```
  - Enable cookies/credentials:
    ```
    CORS_CREDENTIALS=true
    ```

- On startup, backend logs the computed CORS mode and whitelist to help diagnose mismatches.
- See `.env.example` for all options and copy it as a starting point.

4) Install dependencies:
```
npm install
```

5) Run:
```
npm run dev
```

Service:
- Docs: http://localhost:3001/docs (or the configured port)
- Health: GET /

## Frontend integration

- Ensure the frontend is configured to call the correct backend URL, for example:
  - REACT_APP_API_BASE_URL=http://localhost:3001
  - REACT_APP_API_PREFIX=/api
- The frontend should only call these backend APIs; it must not connect directly to MongoDB.
- Swagger/OpenAPI JSON is available at `/openapi.json` and the UI at `/docs`.

## Database Selection Behavior (Important)

To prevent connecting to the default driver database ("test")—which can cause empty results for your data endpoints—the backend selects the database using the following priority:

1. If `MONGODB_DB` is set, that value is used.
2. Otherwise, the backend uses a NODE_ENV-based fallback:
   - development/dev/local/test -> `develop_kaviaroot`
   - qa/staging -> `qa_kaviaroot`
   - production/prod/beta/preprod/pre_prod/pre-prod -> `pre_prod__kaviaroot`
3. If none of the above applies, the driver default database is used (often `"test"`). This is not recommended.

Recommended: Always set `MONGODB_DB` explicitly for deterministic behavior in all environments.

You will see a startup log indicating which database was selected:
```
MongoDB connected to cluster host: <cluster-host> (db: <dbName>)
MongoDB dbName selected via <env|NODE_ENV fallback|driver default>: <dbName or omitted>
Mongoose autoIndex=ENABLED|DISABLED
```

## Optional Collection Verification

For quick verification that you are connected to the expected dataset, you can enable a lightweight startup check:
```
VERIFY_COLLECTIONS=true
```
When enabled, the service will log the estimated document count for the `session_tracking` collection:
```
[Verify] session_tracking estimated count: <number>
```

This is disabled by default to keep startup minimal.

>>>>>>> f193c184bab7d80e62342d9bda3744eee9b1ee24
## Verification (Real-time Data)

### Tenant-wise Users Summary endpoint

<<<<<<< HEAD
The backend exposes an aggregation endpoint to compute distinct active users per tenant, primarily from the session_tracking collection. It powers the Users by Tenant bar chart in the frontend.
=======
- On startup, check logs for a message similar to:
  ```
  MongoDB connected to cluster host: <cluster-host> (db: <dbName>)
  ```
  This log is informational and masks credentials. It indicates the backend is using the specified MongoDB cluster.
  If you set a database via `MONGODB_DB` you will also see:
  ```
  MongoDB dbName selected via env: <your-db>
  Mongoose autoIndex=ENABLED|DISABLED
  ```
- If `MONGODB_URI` is not set, you will see a warning:
  ```
  MONGODB_URI not set in environment. Falling back to built-in default MongoDB URI.
  ```
- Call any data endpoint to verify live results (no auth required). Both kebab-case and camelCase paths are supported to match frontend calls:
  ```
  GET /api/users
  GET /api/session-tracking   OR  /api/sessionTracking
  GET /api/app-deployments    OR  /api/appDeployments
  GET /api/data               # Sample endpoint backed by the "sample" collection
  ```
>>>>>>> f193c184bab7d80e62342d9bda3744eee9b1ee24

- Method: GET
- Path: /api/users/tenant-summary
- Description: Aggregates distinct users per tenant within an optional time range and session status filter. When includeInactive=true is passed, the endpoint falls back to the users and tenants collections to include tenants with no recent activity in the specified window.

Query parameters:
- from (string, ISO date-time, optional): Lower bound of the time range filter. Example: 2024-09-01T00:00:00.000Z
- to (string, ISO date-time, optional): Upper bound of the time range filter. Example: 2024-10-01T00:00:00.000Z
- status (string, optional): Session status filter. Default "completed|active" (i.e., includes sessions with status completed or active).
- includeInactive (boolean, optional, default false): When true, includes tenants from tenants/users collections even if they have no activity in the given period.

Response:
- 200 OK with:
{
  "items": [
    { "tenant_id": "org1", "tenant_name": "Organization One", "user_count": 12 },
    { "tenant_id": "org2", "tenant_name": "Organization Two", "user_count": 5 }
  ],
  "total": 2
}

Notes and caching:
- Results are computed via MongoDB aggregations against session_tracking and optionally joined metadata for tenant names.
- The service employs an in-memory caching layer for this aggregation with a typical TTL of 5 minutes to improve performance under repeated queries with identical parameters. Cache is per-process and non-persistent. On multi-instance deployments, each instance maintains its own cache.
- If includeInactive=true, the query may additionally read from users and tenants collections to ensure tenants with zero recent activity appear with user_count possibly being 0.
- Exact details of the underlying aggregation may evolve as schema evolves; consult routes/users.routes.js and services/users.service.js for implementation.

<<<<<<< HEAD
OpenAPI:
- The endpoint is documented under the Users tag in /openapi.json as /api/users/tenant-summary with parameters and response schema.

Example requests:
- GET /api/users/tenant-summary
- GET /api/users/tenant-summary?from=2024-09-01T00:00:00.000Z&to=2024-10-01T00:00:00.000Z
- GET /api/users/tenant-summary?status=completed|active
- GET /api/users/tenant-summary?includeInactive=true
=======
## Collections & Query Hints

- Users: /api/users
- Session Tracking: /api/session-tracking
- App Deployments: /api/app-deployments
- Sample: /api/data

List supports:
- ?page=1&limit=20  -> returns { success, data, meta }
- Without page/limit -> returns raw array
- ?sort=-created_at
- ?filter={"status":"active"}   (use valid JSON)

## Troubleshooting

- Network Error from frontend:
  - Ensure backend is running (port 3001 by default).
  - Ensure frontend `.env` has `REACT_APP_API_BASE_URL` pointing to the backend and `REACT_APP_API_PREFIX=/api`.
  - In cloud previews, set backend `.env` with `CORS_ALLOW_ALL=true` (or proper origin whitelist) to avoid CORS rejections.
- Empty arrays in responses usually mean:
  - The collection has no data (use /api/dev/seed)
  - The filter JSON excludes all documents (remove or adjust `filter`)
  - Connected to a different database (check logs and /api/dev/db-status)
- Invalid filter JSON returns 400 with message "Invalid filter JSON".
- If you need indexes for performance, enable `MONGOOSE_AUTO_INDEX=true` temporarily or manage indexes directly in MongoDB.
>>>>>>> f193c184bab7d80e62342d9bda3744eee9b1ee24
