# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Docs (Swagger UI): http://localhost:3001/docs
- OpenAPI JSON: http://localhost:3001/openapi.json

Environment example: see .env.example.

CORS
- Defaults allow localhost:3000.
- You can set FRONTEND_ORIGIN or CORS_ORIGINS or define REACT_APP_API_BASE_URL and we infer its origin.

Key routes to verify:
- GET /api/users/active-trend (e.g., http://localhost:3001/api/users/active-trend)
- GET /api/session/tenants (requires Authorization) — lists authorized tenants for logged-in user (READ audit)
- POST /api/session/tenant { tenantId } (requires Authorization) — sets active tenant (UPDATE audit, RBAC enforced)
- GET /api/tenants?scope=self — alias to list authorized tenants using the tenants route

GxP Audit
- Audit logs persisted in collection audit_logs with action (READ/UPDATE), user_id, timestamp, path, IP, userAgent, before/after, and outcome.
- Global request start/end logs also printed via auditLoggerMiddleware for traceability.
