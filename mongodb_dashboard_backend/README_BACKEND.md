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

<<<<<<< HEAD
=======
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

>>>>>>> cga-cg9d6f2ee8
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

## Frontend integration

- Ensure the frontend is configured to call the correct backend URL, for example:
  - REACT_APP_BACKEND_URL=http://localhost:3001
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

## Verification (Real-time Data)

To confirm the backend is connected to the correct MongoDB cluster and the dashboard uses real-time data:

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
<<<<<<< HEAD
=======

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
>>>>>>> cga-cg9d6f2ee8

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

<<<<<<< HEAD
- Endpoints are public and do not require authentication.
- Schema comes from SCHEMA.md and schema.summary.json.
- Validate URLs and dates when sending data.

## Troubleshooting: Empty results on /api/session-tracking

If the `/api/session-tracking` endpoint returns an empty `data` array even though documents exist in your MongoDB cluster, check the following:

1) Confirm the database name
- Set `MONGODB_DB` to the exact database that contains your documents (e.g., `develop_kaviaroot`, `qa_kaviaroot`, `pre_prod__kaviaroot`).
- On startup you should see a log like:
  ```
  MongoDB dbName selected via env: <your-db>
  ```
- If this is missing and you see a warning about relying on the driver default, set `MONGODB_DB`.

2) Confirm the collection name
- Some datasets may use a different collection name or casing.
- Set `SESSION_TRACKING_COLLECTION` to override the collection the backend uses.
  - Default is `session_tracking`.

3) Enable quick verification
- Set `VERIFY_COLLECTIONS=true` to log the estimated count of the `session_tracking` collection at startup (or your override).
- Set `DEBUG_DB_LOGS=true` to log which database and collection are queried by list endpoints, including filter and counts, for quick diagnosis.

Example .env excerpt:
```
PORT=3001
MONGODB_URI=<your-mongodb-uri>
MONGODB_DB=pre_prod__kaviaroot
SESSION_TRACKING_COLLECTION=session_tracking
VERIFY_COLLECTIONS=true
DEBUG_DB_LOGS=true
```

Tip: You can also retrieve a single record to verify connectivity:
```
GET /api/session-tracking?limit=1
```
=======
>>>>>>> cga-cg9d6f2ee8
