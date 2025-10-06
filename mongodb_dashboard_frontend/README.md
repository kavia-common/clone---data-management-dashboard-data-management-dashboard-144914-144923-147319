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
  - REACT_APP_API_BASE_URL (required in cloud preview):
    https://vscode-internal-14377-beta.beta01.cloud.kavia.ai:3001
  - REACT_APP_API_PREFIX (default /api)
- Optional: You may use REACT_APP_API_URL instead of REACT_APP_API_BASE_URL; if both are set, REACT_APP_API_URL is preferred.

3) Run the app
- npm start

App will run at http://localhost:3000 (or your environment preview URL)

Troubleshooting dev server termination (exit 143/SIGTERM) in preview
- In some preview systems the CRA dev server can be terminated by the supervisor if it isn’t reachable externally or the websocket cannot connect.
- Fix by creating .env.development with:
  HOST=0.0.0.0
  PORT=3000
  BROWSER=none
  WDS_SOCKET_HOST=0.0.0.0
  WDS_SOCKET_PORT=3000
  WDS_SOCKET_PATH=/ws
  DANGEROUSLY_DISABLE_HOST_CHECK=true
- These settings ensure the dev server binds to all interfaces and the client websocket connects successfully via the preview/proxy.

### Verify backend connectivity
- The API base URL is resolved as: ${REACT_APP_API_BASE_URL}${REACT_APP_API_PREFIX}
- In development, the console prints:
  [API] baseURL: <resolved> (RAW: <raw> PREFIX: <prefix>) — Ensure REACT_APP_API_BASE_URL is set to https://vscode-internal-14377-beta.beta01.cloud.kavia.ai:3001
- Ensure it points to EXACTLY:
  https://vscode-internal-14377-beta.beta01.cloud.kavia.ai:3001/api
- Backend OpenAPI (for reference): /openapi.json or the provided environment docs URL.

### Users list from Swagger
- The Users screen calls GET /api/users and supports both:
  - Paginated envelope: { success, data: [...], meta: { page, limit, total } }
  - Non-paginated array: [...]
- The component normalizes both shapes; records are shown in a modern Ocean Professional table.

### Troubleshooting "Network error"
- Common causes:
  1. Wrong API base URL or protocol mismatch (http vs https).
     - Fix .env to use the correct origin. For example:
       REACT_APP_API_BASE_URL=https://vscode-internal-14377-beta.beta01.cloud.kavia.ai:3001
  2. Backend not reachable from the frontend origin (server down, wrong port).
     - Open the backend docs URL directly to confirm availability.
  3. CORS rejection on the backend.
     - Ensure backend enables CORS allowing the frontend origin, e.g.:
       origin: ["http://localhost:3000","https://<your-frontend-host>:3000"]
       methods: ["GET","POST","PUT","DELETE","OPTIONS"], credentials: false
  4. Self-signed or invalid TLS certificate when using https.
     - Use a valid certificate or access via http if acceptable in dev.
  5. Mixed content blocked: https page calling http API.
     - Use https for both frontend and backend in secure environments.

### Endpoint compatibility
- This frontend targets:
  - GET/POST /api/users, PUT/DELETE /api/users/:id
  - GET/POST /api/session-tracking, PUT/DELETE /api/session-tracking/:id
  - GET/POST /api/app-deployments, PUT/DELETE /api/app-deployments/:id
- If your backend differs, adjust src/api/client.js paths accordingly.

## Project Structure

- src/
  - api/client.js — Axios client + API functions (CRUD for all collections)
  - components/
    - layout/ — Topbar, Sidebar, AppLayout
    - ui/ — Button, Modal, Card
    - charts/ — KPIChart (Recharts)
    - DataTable.jsx — generic table with sorting and actions
    - UsersList.jsx — reusable users list component that consumes /api/users
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
