# Preview/CI Run Notes for Backend (mongodb_dashboard_backend)

This container already defines proper scripts and defaults:

- Dev: `npm run dev` -> `nodemon -r dotenv/config src/server.js`
- Start: `npm start` -> `node -r dotenv/config src/server.js`
- Entry: `src/server.js`
- Bind: `HOST=0.0.0.0` (default), `PORT=3001` (default)
- Health endpoints:
  - `GET /health` -> 200 OK (no DB required)
  - `GET /api/health` -> 200 OK (reports db=connected|connecting|disconnected)

How to run for preview/CI (non-interactive):

- From this directory (mongodb_dashboard_backend), run:
  CI=true HOST=0.0.0.0 PORT=3001 npm run dev

Notes:

- If you see “Missing script: dev”, it usually means the command was executed in the wrong directory (e.g., the frontend root). Ensure working directory is:
  data-management-dashboard-144914-144923/mongodb_dashboard_backend

- nodemon is installed under devDependencies and will be available during `npm install`. For CI environments that block devDependencies, use:
  CI=true HOST=0.0.0.0 PORT=3001 npm start

- The server will start and respond to `GET /health` with 200 even if MongoDB is not configured. This is safe for readiness checks in preview.
