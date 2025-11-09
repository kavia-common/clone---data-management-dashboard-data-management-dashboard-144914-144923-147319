# Runtime notes for preview/CI

- Start command: npm start (ensures dotenv is loaded) or node src/server.js (dotenv is auto-loaded now).
- Default bind: HOST=0.0.0.0 PORT=3001 (overridable via PORT env; previews may set 3010).
- Health endpoints:
  - GET /api/health returns 200 and includes db: connected|connecting|disconnected (DB may be disconnected and still 200 for readiness).
  - GET /health returns `{ status: "ok", ... }` and is safe for readiness checks.
- MongoDB: If MONGODB_URI is unset, the server still starts. Logs a warning and health shows db=disconnected.

Troubleshooting
- If port 3001 is reported unavailable, check logs for [startup] and EADDRINUSE.
- Dev routes are disabled in production unless ALLOW_DEV_ROUTES=true.

Local development quick check
- npm install
- npm run dev  (binds to 0.0.0.0:3001 with nodemon)
- curl http://localhost:3001/health  (or /api/health) should return 200 JSON.
- No need for `-r dotenv/config`; dotenv is programmatically loaded in src/server.js.
