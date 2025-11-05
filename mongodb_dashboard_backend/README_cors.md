# CORS and Frontend Integration

This backend enables CORS with an allowlist and supports credentials.

Environment variables:
- FRONTEND_ORIGIN: Single allowed origin for your React app (e.g., http://localhost:3000).
- CORS_ORIGIN: Single explicit allowed origin (alternative to FRONTEND_ORIGIN).
- CORS_ORIGINS: Comma-separated list of allowed origins.
- CORS_CREDENTIALS: "true" to enable credentialed requests.
- REACT_APP_API_BASE_URL: If your frontend uses this, its origin is inferred and allowed.

Defaults:
- http://localhost:3000
- https://localhost:3000
- https://kavia-dashboard-kavia-dev.cloud.kavia.ai (preview)

Preflight:
- OPTIONS preflight is handled for all /api/* routes and returns 204 with proper headers.

Health:
- GET /api/health returns 200 and includes DB state. Use it to validate CORS quickly from the browser console:
  fetch('<BACKEND>/api/health', { credentials: 'include' }).then(r => r.json()).then(console.log)

Base URL (frontend):
- Ensure the frontend points to the backend base: http://localhost:3001 (or the preview backend host).
- Recommended to expose BACKEND_BASE_URL in frontend .env and have API calls prefix with it.
