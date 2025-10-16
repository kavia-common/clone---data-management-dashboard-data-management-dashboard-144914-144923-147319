# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Docs (Swagger UI): http://localhost:3001/docs
- OpenAPI JSON: http://localhost:3001/openapi.json

Environment example: see .env.example.

MongoDB configuration
- Set MONGODB_URI in your environment. This is required; the app no longer uses any hard-coded default URI.
- Optional: MONGODB_DB to select a database by name.
- The server attempts to connect on startup with retries and logs clear messages on failures.
- Requests to API routes will return 503 Service Unavailable until the database is connected (health/docs remain available).

Troubleshooting buffering timeouts
- If you see "Operation users.find() buffering timed out...", it indicates the app is not connected to MongoDB.
- Ensure MONGODB_URI is set correctly and reachable from this container.
- Check logs for [db] messages; the last connection error is also exposed in 503 responses as "details".

CORS
- Defaults allow localhost:3000.
- You can set FRONTEND_ORIGIN or CORS_ORIGINS or define REACT_APP_API_BASE_URL and we infer its origin.

Key routes to verify:
- GET / -> health
- GET /api/users -> returns 200 (empty list or data) once DB is connected
- GET /api/users/seed-if-empty -> seeds demo users in an empty collection for smoke testing
- GET /api/users/active-trend (e.g., http://localhost:3001/api/users/active-trend)
