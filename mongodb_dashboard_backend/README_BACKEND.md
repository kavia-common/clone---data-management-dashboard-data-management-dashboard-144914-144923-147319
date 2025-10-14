# Dashboard Backend (Express + MongoDB)

## Authentication salt

- SECRET_SALT is the single source of truth for tenant encryption and related signing helpers.
- Format: URL-safe base64 (base64url), no padding, typically 22–24 chars. Example: `g5StFHvCyj0Hf9g8j87nGA`.
- Generate:
  - Node: `node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"`
- Legacy variables (AUTH_TENANT_SALT, QA_SALT, PASSWORD_SALT) are ignored if SECRET_SALT is present.
- The `/api/auth/health` endpoint reports configuration status without exposing the secret.

See `.env.example` for the exact variables.

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

## Authentication Configuration

The backend reads authentication-related configuration from environment variables and responds gracefully if they are missing or weak. It will not crash with HTTP 500.

Required/Recommended variables:
- AUTH_TENANT_SALT: Salt used for tenant/organization encryption/validation. Must be at least 12 characters and not a placeholder like "changeme".
- AUTH_JWT_SECRET: Secret used for signing JWTs (when JWT auth is enabled).
- Optional legacy compatibility: PASSWORD_SALT, QA_SALT will be read if provided.

Tenant resolution (multi-tenant support for login):
- AUTH_TENANT_STRATEGY: How to derive tenant for /api/auth/login.
  - "body": use body.organization_id
  - "host": parse leftmost label from Host header (e.g., qa.example.com -> "qa")
  - "body-or-host": prefer body value, else host (default)
  - "host-or-body": prefer host value, else body
- AUTH_DEFAULT_TENANT: Fallback tenant when none is derivable (default "default").
- AUTH_EXPECTED_TENANTS: CSV allowlist of allowed tenants. If set, login is rejected for tenants not listed.
- AUTH_TENANT_MAPPING: JSON mapping of tenant -> credentials/meta. If provided, only mapped tenants are accepted.

See .env.example for a template.

Behavior when misconfigured:
- POST /api/auth/login returns 400 with a clear message if:
  - AUTH_TENANT_SALT is missing or weak
  - Tenant cannot be resolved or is not allowed per AUTH_EXPECTED_TENANTS / AUTH_TENANT_MAPPING
- GET /api/auth/health returns status flags to help verify configuration without exposing secrets.

Once AUTH_TENANT_SALT and tenant config are properly set, the stub login will validate inputs and return:
- 200 with { success: true, tenant_id, token: "ok" } for a valid stub login
- 401 for invalid credentials (e.g., malformed email in this stub)
- 422 for validation errors

## Setup

1) Configure MongoDB
- The service reads the MongoDB connection string from the environment variable:
  - `MONGODB_URI`
- You can optionally force the database name by setting:
  - `MONGODB_DB` (e.g., develop_kaviaroot / qa_kaviaroot / pre_prod__kaviaroot)
- Automatic index creation is disabled by default to avoid failures on existing datasets.
  - To enable, set: `MONGOOSE_AUTO_INDEX=true`
- A `.env.example` is provided. Copy it to `.env` (or set environment variables in your runtime):
  ```
  cp .env.example .env
  ```
- By default (if `MONGODB_URI` is not set), the service will use the following URI:
  ```
  mongodb+srv://govindarajmalaiarasu_db_user:MGRaj2005@phaseonedata.qlyhyxu.mongodb.net/?retryWrites=true&w=majority&appName=PhaseOneData
  ```
- To override or ensure explicit configuration, set:
  ```
  MONGODB_URI=<your-mongodb-uri>
  MONGODB_DB=<your-db-name> # optional
  MONGOOSE_AUTO_INDEX=true   # optional
  ```

2) Configure CORS
- The backend includes a robust CORS middleware that:
  - Reads allowed origins from:
    - `CORS_ORIGIN` (single origin) and/or
    - `CORS_ORIGINS` (comma-separated list)
  - Auto-allows the origin derived from `REACT_APP_API_BASE_URL` if provided (commonly set in the frontend).
    - Example: if `REACT_APP_API_BASE_URL=https://host:3001/api`, backend will allow `https://host:3000` and the exact origin derived from the API base URL.
  - Adds sensible defaults for local development: `http://localhost:3000`, `https://localhost:3000`.
  - Honors `CORS_CREDENTIALS=true` to enable credentialed requests.

- Local development (recommended):
  - Backend runs on 3001 and frontend on 3000.
  - Frontend must set:
    ```
    REACT_APP_API_BASE_URL=http://localhost:3001/api
    ```
  - Backend already allows `http://localhost:3000` by default. No additional CORS envs are required for this pairing.
  - If your frontend uses credentialed requests (cookies), also set:
    ```
    CORS_CREDENTIALS=true
    ```

- Typical configurations (hosted/prod):
  - Single origin:
    ```
    CORS_ORIGIN=https://app.example.com
    ```
  - Multiple origins:
    ```
    CORS_ORIGINS=https://app.example.com,https://admin.example.com
    ```
  - Derive from frontend API base (when frontend build injects this):
    ```
    REACT_APP_API_BASE_URL=https://api.example.com/api
    ```
  - Enable cookies/credentials:
    ```
    CORS_CREDENTIALS=true
    ```

- On startup, backend logs the computed CORS whitelist to help diagnose mismatches.
- See `.env.example` for all options and copy it as a starting point.

3) Install dependencies:
```
npm install
```

4) Run:
```
npm run dev
```

Service:
- Docs: http://localhost:3001/docs (or the port configured by your environment)
- Health: GET /

## Verification (Real-time Data)

### Tenant-wise Users Summary endpoint

The backend exposes an aggregation endpoint to compute distinct active users per tenant, primarily from the session_tracking collection. It powers the Users by Tenant bar chart in the frontend.

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

OpenAPI:
- The endpoint is documented under the Users tag in /openapi.json as /api/users/tenant-summary with parameters and response schema.

Example requests:
- GET /api/users/tenant-summary
- GET /api/users/tenant-summary?from=2024-09-01T00:00:00.000Z&to=2024-10-01T00:00:00.000Z
- GET /api/users/tenant-summary?status=completed|active
- GET /api/users/tenant-summary?includeInactive=true

### Project name resolution endpoint

The backend exposes a lightweight resolver to map a project_id to a human‑friendly project name, primarily from the App Deployments collection.

- Method: GET
- Path: /api/app-deployments/project/{projectId}/name
- Description: Attempts to match the provided projectId across multiple common fields in app_deployments: projectId, project_id, metadata.projectId, project.id. If a name is available, it is returned from any of: projectName, project_name, metadata.projectName, or project.name. The endpoint always returns 200 with a normalized id and a projectName that may be null if a name cannot be found.

Parameters:
- path projectId (string) — the identifier to resolve

Response example:
{
  "projectId": "my-project-123",
  "projectName": "My Project"
}

If not found:
{
  "projectId": "my-project-123",
  "projectName": null
}

Caching:
- 5-minute in-memory cache per process is used for projectId -> projectName results.
- Cache entries are invalidated automatically when App Deployments are modified:
  - POST /api/app-deployments: invalidates the project id found in the payload
  - PUT /api/app-deployments/{id}: invalidates the project id in the payload, or inferred from the existing record
  - DELETE /api/app-deployments/{id}: invalidates the project id inferred from the deleted record
- This cache is non-persistent and per-instance; in multi-instance deployments, each instance maintains its own cache.

OpenAPI:
- The resolver is documented in the generated OpenAPI at /openapi.json under the AppDeployments tag.

To confirm the backend is connected to the correct MongoDB cluster and the dashboard uses real-time data:

- On startup, check logs for a message similar to:
  ```
  MongoDB connected to cluster host: phaseonedata.qlyhyxu.mongodb.net (db: <dbName>)
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

- Seed demo data if your collections are empty:
  ```
  GET /api/dev/seed
  ```
  This will insert minimal demo records into users, sample, session_tracking and app_deployments if empty.

- Quick verification endpoint:
  ```
  GET /api/dev/verify
  ```
  Returns counts and a few sample documents from each collection to confirm data presence.

- DB connection status:
  ```
  GET /api/dev/db-status
  ```

Notes:
- The frontend should only call these backend APIs. It should not connect directly to MongoDB.
- The backend uses `process.env.MONGODB_URI` if set, otherwise the provided default.

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

- Empty arrays in responses usually mean:
  - The collection has no data (use /api/dev/seed)
  - The filter JSON excludes all documents (remove or adjust `filter`)
  - Connected to a different database (check logs and /api/dev/db-status)
- Invalid filter JSON returns 400 with message "Invalid filter JSON".
- If you need indexes for performance, enable `MONGOOSE_AUTO_INDEX=true` temporarily or manage indexes directly in MongoDB.

