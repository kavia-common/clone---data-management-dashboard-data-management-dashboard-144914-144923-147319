# Data Management Dashboard (Fullstack)

This repository contains:
- Backend (Express + MongoDB) at ./mongodb_dashboard_backend
- Frontend (React) at ../data-management-dashboard-144914-144924/mongodb_dashboard_frontend

## New: Agents Analytics (Group by Agents)

- Backend: `GET /api/analytics/agents` aggregates agent usage/cost from session_tracking and llm_costs with optional filters (tenant_id, project_id, from, to) and pagination (limit, offset).
- Frontend: New page at `/agents` showing a bar chart (cost by agent) and a sortable table (usage, sessions).
- Filters: tenant_id and project_id fields available; date filters default to last 30 days on backend.

Run:
- Backend: `npm start` (port 3001)
- Frontend: `npm start` (port 3000)

Docs:
- Swagger UI: http://localhost:3001/docs
- OpenAPI JSON: http://localhost:3001/openapi.json
