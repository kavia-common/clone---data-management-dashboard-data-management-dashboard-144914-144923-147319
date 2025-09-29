# Dashboard Backend (Express + MongoDB)

This backend provides RESTful APIs for dashboard collections (public access; no authentication) and health checks.

Key features:
- Express.js with Helmet, CORS, Rate Limiting
- MongoDB via Mongoose with indexes per schema guidance
- Public CRUD for:
  - session_tracking
  - app_deployments
- Swagger docs at /docs with dynamic server URL

## Setup

1) Configure MongoDB URI
- The service will use the following default URI if `MONGODB_URI` is not set:
  mongodb+srv://govindarajmalaiarasu_db_user:MGRaj2005@phaseonedata.qlyhyxu.mongodb.net/?retryWrites=true&w=majority&appName=PhaseOneData
- To override, set the environment variable:
  MONGODB_URI=<your-mongodb-uri>

2) Install dependencies:
npm install

3) Run:
npm run dev

Service:
- Docs: http://localhost:3001/docs
- Health: GET /

## Collections

- Session Tracking: /api/session-tracking
- App Deployments: /api/app-deployments

List supports:
- ?page=1&limit=20
- ?sort=-created_at
- ?filter={"status":"active"}

## Notes

- Endpoints are public and do not require authentication.
- Schema comes from SCHEMA.md and schema.summary.json.
- Validate URLs and dates when sending data.
