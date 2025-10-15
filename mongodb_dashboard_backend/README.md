# Backend (Express) - Dashboard API

- Default port: 7001 (configurable via PORT in .env)
- Docs (Swagger UI): http://localhost:7001/docs
- OpenAPI JSON: http://localhost:7001/openapi.json

Environment example: see .env.example.

CORS
- Defaults allow localhost:3000.
- You can set FRONTEND_ORIGIN or CORS_ORIGINS or define REACT_APP_API_BASE_URL and we infer its origin.

Key route to verify:
- GET /api/users/active-trend (e.g., http://localhost:7001/api/users/active-trend)
