# Data Management Dashboard

A fullstack dashboard application to visualize and manage data stored in MongoDB, using:
- Backend: Express.js (runs on port 3001)
- Frontend: React (runs on port 3000)
- Database: MongoDB (via Mongoose)

This project provides REST APIs for dashboard data, user management, and analytics, and a React web UI that consumes those APIs.

## Project Structure

- mongodb_dashboard_backend/ — Express backend (REST API, MongoDB access)
- Frontend (separate workspace): data-management-dashboard-144914-144924/mongodb_dashboard_frontend

## Prerequisites

- Node.js (LTS recommended)
- MongoDB connection (Atlas or self-hosted)
- npm or yarn

## Setup

1) Backend (Express + MongoDB)
- Location: data-management-dashboard-144914-144923/mongodb_dashboard_backend
- Copy environment template (see provided .env.example in the backend folder) and update values as needed:
  cp .env.example .env
- Install dependencies:
  npm install
- Run in development (nodemon):
  npm run dev
- Backend will be available at:
  http://localhost:3001
- API docs:
  http://localhost:3001/docs

2) Frontend (React)
- Location: data-management-dashboard-144914-144924/mongodb_dashboard_frontend
- Copy environment template if provided and configure API base URL to point to the backend:
  REACT_APP_API_BASE_URL=http://localhost:3001/api
- Install dependencies:
  npm install
- Run:
  npm start
- Frontend will be available at:
  http://localhost:3000

## Environment

- The backend depends on a MongoDB connection. See the backend README for details and the .env.example included there for available variables.
- Do not connect the frontend directly to MongoDB; use the backend REST API.

## Common Endpoints (Backend)

- Health: GET /
- Users: GET /api/users
- Session Tracking: GET /api/session-tracking
- App Deployments: GET /api/app-deployments
- Sample Data: GET /api/data
- Users by Tenant (analytics): GET /api/users/tenant-summary

Refer to the backend’s OpenAPI at /openapi.json or the docs at /docs for the full specification.

## Notes

- Local development pairing:
  - Backend: http://localhost:3001
  - Frontend: http://localhost:3000
- Ensure CORS is configured to allow the frontend origin. The backend includes sensible defaults for localhost.
