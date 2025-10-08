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

