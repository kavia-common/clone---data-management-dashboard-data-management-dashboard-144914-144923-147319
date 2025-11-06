# Runtime notes for preview/CI

- Start command: npm start (ensures dotenv is loaded) or node src/server.js (dotenv is auto-loaded now).
- Default bind: HOST=0.0.0.0 PORT=3001
- Health endpoint: GET /api/health returns 200 regardless of DB connection; payload includes db: connected|connecting|disconnected.
- MongoDB: If MONGODB_URI is unset, the server still starts. Logs a warning and health shows db=disconnected.

Auth & Tenant
- Configure SESSION_SECRET to enable cookie-based sessions set on /api/auth/login (id_token, tenant_id).
- JWT verification prefers RS256 with JWT_PUBLIC_KEY/JWT_PUBLIC_KEY_FILE, otherwise HS256 via JWT_SECRET.
- Middleware reads token from Authorization: Bearer header, id_token cookie, or session.id_token.
- All protected routes enforce tenant_id scoping via middleware and query helpers.

Troubleshooting
- If port 3001 is reported unavailable, check logs for [startup] and EADDRINUSE.
- Dev routes are disabled in production unless ALLOW_DEV_ROUTES=true.
