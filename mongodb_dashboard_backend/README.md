# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Docs (Swagger UI): http://localhost:3001/docs
- OpenAPI JSON: http://localhost:3001/openapi.json

Environment example: see .env.example.

## MongoDB connection and readiness

- The server now waits for a successful MongoDB connection before it starts listening for HTTP requests. This prevents Mongoose buffering timeouts like "Operation `users.find()` buffering timed out after 10000ms".
- Configure MONGODB_URI in your .env. For local development without a running MongoDB instance, install and start MongoDB locally or point to a reachable Atlas cluster.
- Diagnostics:
  - GET /api/dev/db-status shows connection state (connected flag and readyState).
  - Startup logs include connection attempts and errors.
- Tuning (env):
  - DB_CONNECT_RETRIES (default 3), DB_CONNECT_RETRY_DELAY_MS (default 1500)
  - MONGOOSE_* options in .env.example

## CORS

The backend enables secure, environment-driven CORS and must run before route handlers.

- Default allowed origin: http://localhost:3000
- To override, set one of:
  - FRONTEND_ORIGIN=https://your-frontend.example.com
  - CORS_ORIGIN=https://single-origin.example.com
  - CORS_ORIGINS=https://one.example.com,https://two.example.com
  - REACT_APP_API_BASE_URL can be used to infer an origin (its scheme+host are allowed)
- Credentials: Set CORS_CREDENTIALS=true to allow cookies/authorization headers across origins.
- Allowed methods: GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS
- Allowed headers: Content-Type, Authorization, X-Requested-With, Accept
- Exposed headers: Content-Length, ETag

Preflight requests (OPTIONS) are handled automatically.

Key route to verify:
- GET /api/users/active-trend (e.g., http://localhost:3001/api/users/active-trend)
