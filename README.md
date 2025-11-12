# Data Management Dashboard

This project contains two containers:
- Backend (Express): data-management-dashboard-144914-144923/mongodb_dashboard_backend
- Frontend (React): data-management-dashboard-144914-144924/mongodb_dashboard_frontend

Frontend setup:
- cd data-management-dashboard-144914-144924/mongodb_dashboard_frontend
- Copy .env.example to .env
- Ensure REACT_APP_API_BASE_URL points to your backend (e.g., http://localhost:3001)

Backend preview/startup:
- IMPORTANT: Do NOT run `npm run dev` from the frontend folder; it will fail with "Missing script: dev".
- To start the backend preview:
  1) cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
  2) npm install
  3) npm run dev   # binds HOST=0.0.0.0 PORT=3001 by default (nodemon)
- Production-style:
  - npm start      # node src/server.js, same HOST/PORT behavior

Readiness/health endpoints (return 200 quickly):
- GET http://localhost:3001/health       (fast readiness)
- GET http://localhost:3001/ready        (alias to /health)
- GET http://localhost:3001/api/health   (includes db connection state)

Notes:
- dotenv is loaded programmatically in src/server.js; you do not need to use "-r dotenv/config" flags in scripts.
- If a preview runner insists on `npm run dev`, ensure it runs in the backend directory:
  cd data-management-dashboard-144914-144923/mongodb_dashboard_backend && npm run dev
