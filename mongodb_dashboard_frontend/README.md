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
  - Or leave it unset when running in an HTTPS preview to use the proxy

3) Run the app
- npm start

App will run at http://localhost:3000 (or your preview URL)

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

The frontend supports two variable names for the backend base URL (either is fine):
- REACT_APP_API_URL: Backend API root (takes precedence if set)
- REACT_APP_API_BASE_URL: Backend API root (recommended)

Other variables:
- REACT_APP_API_PREFIX: API prefix used by the backend. Default: /api
- REACT_APP_BACKEND_PORT: Used for auto-detection when REACT_APP_API_BASE_URL is not set. Default: 3001

Setup steps:
- Copy .env.example to .env
- For local dev:
  - REACT_APP_API_BASE_URL=http://localhost:3001
- For cloud preview (example):
  - REACT_APP_API_BASE_URL=https://vscode-internal-19172-beta.beta01.cloud.kavia.ai:3001

Notes:
- Do not commit .env; use .env.example as reference.
- If you encounter “Network Error” from Axios, verify:
  1) The backend is reachable at the URL you configured (open it in the browser)
  2) The port matches your backend server port (default 3001)
  3) CORS is allowed by the backend (or access via same-origin proxy)
  4) The API prefix matches your backend (default /api)

## Proxy and HTTPS

In secure preview environments (https), browsers will block http requests to a backend (mixed content). To prevent this, the app includes a development proxy:

- src/setupProxy.js forwards:
  - /api -> backend (http://localhost:3001 by default)
  - /openapi.json -> backend
- If REACT_APP_API_BASE_URL is NOT set, the API client uses a relative base (/api), which the dev server proxies to the backend.
- If you set REACT_APP_API_BASE_URL in an https environment, make sure the backend is also available over https at that URL. Otherwise leave it unset to use the proxy.

Verification:
- Start backend on port 3001
- Start frontend (npm start)
- Visit the app, open DevTools -> Network
- Confirm requests go to /api/... and succeed
- Check /openapi.json request (health check) succeeds (200)

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
