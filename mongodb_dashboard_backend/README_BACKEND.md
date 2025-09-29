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
  MONGODB_DB=<your-db-name> # optional
  MONGOOSE_AUTO_INDEX=true   # optional
  ```

2) Configure CORS
- By default, the backend now explicitly allows the frontend origin:
  ```
  https://vscode-internal-28199-beta.beta01.cloud.kavia.ai:4000
  ```
- To customize:
  - Single origin:
    ```
    CORS_ORIGIN=https://your-frontend.example.com
    ```
  - Multiple origins (comma-separated):
    ```
    CORS_ORIGINS=https://app.example.com,https://admin.example.com
    ```
  - If your frontend sends cookies or uses `credentials: 'include'` (or axios `withCredentials: true`):
    ```
    CORS_CREDENTIALS=true
    ```
    Note: Credentialed requests cannot work with `Access-Control-Allow-Origin: *`; an explicit origin is required (the middleware handles this).
- See `.env.example` for all options.

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
  GET /api/session-tracking   OR  /api/sessionTracking
  GET /api/app-deployments    OR  /api/appDeployments
  GET /api/users
  ```
  If documents exist in your cluster, responses will reflect the current, real-time state.

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
