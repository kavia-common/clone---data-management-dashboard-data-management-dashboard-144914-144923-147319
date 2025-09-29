# Dashboard Backend (Express + MongoDB)

This backend provides RESTful APIs with secure authentication and CRUD endpoints for collections derived from SCHEMA.md and schema.summary.json.

Key features:
- Express.js with Helmet, CORS, Rate Limiting
- MongoDB via Mongoose with indexes per schema guidance
- JWT-based auth (register/login/me)
- CRUD for:
  - users (referral fields)
  - session_tracking
  - app_deployments
- Swagger docs at /docs with dynamic server URL

## Setup

1) Copy environment:
cp .env.example .env
Edit variables as needed, especially:
- MONGODB_URI
- JWT_SECRET

2) Install dependencies:
npm install

3) Run:
npm run dev

Service:
- Docs: http://localhost:3001/docs
- Health: GET /

## Auth

- POST /api/auth/register { email, password, role? }
- POST /api/auth/login { email, password }
- GET /api/auth/me (Bearer token required)

Include header:
Authorization: Bearer <token>

## Collections

- Users: /api/users
- Session Tracking: /api/session-tracking
- App Deployments: /api/app-deployments

List supports:
- ?page=1&limit=20
- ?sort=-created_at
- ?filter={"status":"active"}

## Notes

- For emails, consider field-level encryption in production.
- Ensure robust MONGODB_URI per environment.
- Schema comes from SCHEMA.md and schema.summary.json.
