# data-management-dashboard-144914-144924

Frontend environment setup:
- Navigate to mongodb_dashboard_frontend
- Copy .env.example to .env
- Ensure REACT_APP_API_BASE_URL points to your backend (e.g., http://localhost:3001 or your deployed URL)

Backend preview/startup
- IMPORTANT: Do not run `npm run dev` from the frontend folder. It will fail with "Missing script: dev".
- To start the backend preview:
  1) cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
  2) npm install
  3) npm run dev   # binds to 0.0.0.0:3001 with nodemon
- Health/readiness checks:
  - GET http://localhost:3001/health (fast, 200)
  - GET http://localhost:3001/api/health (includes db state)
- No need to use "-r dotenv/config"; dotenv is loaded programmatically in src/server.js.