# Preview and Scripts Notes

- Always run backend preview commands from this directory:
  data-management-dashboard-144914-144923/mongodb_dashboard_backend

- Scripts:
  - npm run dev
    - In local/dev: uses nodemon with auto-reload.
    - In CI (CI=true): falls back to node (no nodemon) and still binds to HOST and PORT.
  - npm run dev:ci
    - Explicit CI-safe start without nodemon; kills stale processes on the specified port.
  - npm run start:ci
    - Production-mode start, also CI-safe.

- Environment:
  - HOST defaults to 0.0.0.0
  - PORT defaults to 3001

- Health:
  - Readiness endpoint: /health (no DB required)
  - Extended health: /api/health (includes DB status)

Ensure the preview runner working directory points to mongodb_dashboard_backend, not the frontend.
