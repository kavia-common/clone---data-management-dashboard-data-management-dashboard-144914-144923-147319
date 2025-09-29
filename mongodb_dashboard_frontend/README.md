# MongoDB Dashboard Frontend (React)

Modern, modular React dashboard styled with the "Ocean Professional" theme to manage data via an Express.js API.

## Highlights

- No authentication required: the dashboard loads directly for all users.
- Collections: Users, Session Tracking, App Deployments — CRUD UIs with modals and data tables.
- Charts: KPI area chart for overview/trends.
- Theming: Blue primary and amber accents, subtle gradients, rounded surfaces.
- API Integration: Axios instance with interceptors, environment‑based base URL, standardized helpers.
- Structure: Clean separation of pages, components, routes, and API client.

## Quickstart

1) Install dependencies
- npm install

2) Configure environment
- Copy .env.example to .env and set:
  - REACT_APP_API_BASE_URL (e.g., http://localhost:3001)

3) Run the app
- npm start

App will run at http://localhost:3000

## Project Structure

- src/
  - api/client.js — Axios client + API functions (CRUD for all collections)
  - components/
    - layout/ — Topbar, Sidebar, AppLayout
    - ui/ — Button, Modal, Card
    - charts/ — KPIChart (Recharts)
    - DataTable.jsx — generic table with sorting and actions
  - pages/
    - dashboard/Overview.jsx, Users.jsx, Sessions.jsx, Deployments.jsx
  - routes/AppRoutes.jsx — public routes
  - App.js — root composition
  - App.css / index.css — Ocean Professional theme styles

## Environment Variables

- REACT_APP_API_BASE_URL: Backend API root (recommended). Example: http://localhost:3001
- REACT_APP_API_PREFIX: API prefix used by the backend. Default: /api
- REACT_APP_BACKEND_PORT: Used for auto-detection when REACT_APP_API_BASE_URL is not set. Default: 3001

Note: Do not commit .env; use .env.example as reference.

## API Endpoints

The frontend expects conventional REST endpoints:
- Users: GET/POST /users, PUT/DELETE /users/:id
- Sessions: GET/POST /session-tracking, PUT/DELETE /session-tracking/:id
- Deployments: GET/POST /app-deployments, PUT/DELETE /app-deployments/:id

Adjust src/api/client.js if your backend differs.

## Accessibility and Security

- Keyboard-accessible modals and buttons
- If your backend requires authentication, wire it in your API gateway/reverse proxy as needed; the UI does not enforce auth.

## Customization

- Update colors and radii in App.css variables.
- Extend DataTable columns and forms based on your schema.
- Add pagination and server-side filters as your API supports them.

## Testing

- CRA testing setup is included; extend tests in src/.
