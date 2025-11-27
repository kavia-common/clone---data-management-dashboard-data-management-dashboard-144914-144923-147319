# Environment Notes (Backend)

This backend uses Express and does not include Webpack or a React dev server. It is designed to start reliably both locally and in CI/preview environments.

Key behaviors
- Host binding: The server binds to 0.0.0.0 by default to avoid EADDRNOTAVAIL when running in containers or preview environments.
- Port: Default is PORT=3001. Configure via .env if needed.
- dotenv: .env is loaded in code (src/server.js) so no special Node flags are required.

Frontend proxy configuration (important)
- When the frontend dev server proxies API requests to this backend, configure the target to a reachable host:
  - Same machine: http://127.0.0.1:3001
  - Different containers: http://<backend-container-hostname>:3001
- Do not use 0.0.0.0 as a proxy target. 0.0.0.0 is valid for listening but not as a target.
- If you see EADDRNOTAVAIL or ECONNREFUSED from the frontend dev proxy, validate that the target host is resolvable and reachable, and ensure the backend is running and bound to the correct port.

Dev server and CI reliability
- Node engine: Prefer Node 18.x to 20.x (see package.json engines). This avoids unexpected behavior with older runtimes.
- Scripts:
  - npm run dev — starts the backend with NODE_ENV=development. If the port is already in use (e.g., another instance is running), it exits without failing CI (script ends with `|| true`).
  - npm run preview — same behavior as dev for preview systems, ensuring non-fatal exit in orchestrators.
  - npm run dev:watch — nodemon with hot reload for local development (not recommended in low-resource preview environments).
- The server writes readiness markers to stdout:
  - READY: http://HOST:PORT
  - BACKEND_READY: url=http://HOST:PORT
  - Listening on http://HOST:PORT
- Health endpoints:
  - GET /health
  - GET /api/health
  - GET /ready
- MongoDB is optional at startup. If MONGODB_URI isn’t set, the server still starts and health endpoints respond with db: disconnected. Set:
  - MONGODB_URI=mongodb+srv://...
  - MONGODB_DB=your-db-name

CORS and debugging
- By default, CORS allows common local development origins (localhost:3000) and the known VS Code preview origin.
- For /api/* routes, a permissive CORS middleware is applied (non-credentialed with Access-Control-Allow-Origin: *).
- To adjust allowed origins for credentialed CORS, set:
  - CORS_ORIGIN, FRONTEND_ORIGIN, or CORS_ORIGINS (comma-separated list)
  - CORS_CREDENTIALS=true to enable credentialed requests (do not combine with ACAO "*").
- Set DEBUG=true to enable additional debug logs for CORS and auth/tenant resolution.

Webpack dev middleware deprecations (frontend)
- Any “webpack-dev-middleware deprecation” warnings come from the frontend and are non-fatal for this backend. Backend does not use Webpack.
- If needed, upgrade frontend tooling or adjust its devServer configuration. This backend will continue to operate independently.

Proxy and networking checklist
- Verify the frontend proxy target uses http://127.0.0.1:3001 for same-host scenarios.
- Ensure there is no mismatch between HOST/PORT in the backend and the frontend proxy target.
- Confirm firewall rules allow connections between the frontend and backend containers (if running in separate containers).

Troubleshooting
- EADDRINUSE on start:
  - Another instance already bound the port. Stop the existing process or use a different PORT.
- ECONNREFUSED from frontend:
  - Backend not running on target host/port, or incorrect proxy target host.
- CORS issues:
  - Enable DEBUG=true to see CORS logs and verify origins.
  - Adjust CORS_ORIGIN/FRONTEND_ORIGIN/CORS_ORIGINS as needed.
