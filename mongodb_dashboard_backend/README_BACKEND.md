# Dashboard Backend (Express + MongoDB)

This backend provides RESTful APIs for dashboard collections (public access; no authentication) and health checks.

Key features:
- Express.js with Helmet, CORS, Rate Limiting
- MongoDB via Mongoose with indexes per schema guidance
- Public CRUD for users, session_tracking, app_deployments, and sample (demo)
- Swagger docs at /docs with dynamic server URL

## Setup

1) MongoDB
- Configure via environment variables shown in the provided .env.example (copy it to .env).
- Uses MONGODB_URI for the connection string, optionally MONGODB_DB for db name.
- Optionally enable Mongoose auto index creation via MONGOOSE_AUTO_INDEX=true.

2) Install dependencies
- npm install

3) Run
- npm run dev
- Service: http://localhost:3001
- Docs: http://localhost:3001/docs
- Health: GET /

## Notes

- For local development, pair with the React frontend at http://localhost:3000 and set REACT_APP_API_BASE_URL=http://localhost:3001/api on the frontend.
- Backend CORS allows localhost defaults and can be configured using CORS_ORIGIN or CORS_ORIGINS. See .env.example for details.

