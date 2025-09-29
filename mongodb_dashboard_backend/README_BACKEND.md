# Dashboard Backend (Express + MongoDB)

This backend provides RESTful APIs for dashboard collections (public access; no authentication) and health checks.

Key features:
- Express.js with Helmet, CORS, Rate Limiting
- MongoDB via Mongoose with indexes per schema guidance
- Public CRUD for:
  - session_tracking
  - app_deployments
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
  MONGODB_DB=<your-db-name> # optional but recommended
  MONGOOSE_AUTO_INDEX=true   # optional
  ```

2) Install dependencies:
```
npm install
```

3) Run:
```
npm run dev
```

Service:
- Docs: http://localhost:3001/docs (or the port configured by your environment)
- Health: GET /

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
- Call any data endpoint to verify live results (no auth required). Both kebab-case and camelCase paths are supported to match various frontends:
  ```
  GET /api/session-tracking   OR  /api/sessionTracking
  GET /api/app-deployments    OR  /api/appDeployments
  GET /api/users
  ```
  If documents exist in your cluster and the correct database is selected, responses will reflect the current, real-time state.

Note:
- The frontend should only call these backend APIs. It should not connect directly to MongoDB.
- The backend does not overwrite `MONGODB_URI` with any placeholders; it uses `process.env.MONGODB_URI` if set, otherwise the provided default.

## Collections

- Session Tracking: /api/session-tracking
- App Deployments: /api/app-deployments

List supports:
- ?page=1&limit=20
- ?sort=-created_at
- ?filter={"status":"active"}

## Notes

- Endpoints are public and do not require authentication.
- Schema comes from SCHEMA.md and schema.summary.json.
- Validate URLs and dates when sending data.
