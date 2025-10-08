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

## Project Name Resolution (Deployments UI)

To display a project's friendly name from a project_id, the frontend provides both a direct API call and a React hook.

Environment
- REACT_APP_API_BASE_URL (e.g., http://localhost:3001)
- REACT_APP_API_PREFIX (default /api)
- Optional: REACT_APP_DANGEROUSLY_DISABLE_HOST_CHECK (used by dev server; not required for this feature)

Direct API helper
- Function: getProjectName(projectId)
- Location: src/api/projectName.js
- Behavior: Calls GET /api/app-deployments/project/{projectId}/name and returns { projectId, projectName } with projectName possibly null. Throws on network or server errors.

React hook
- Hook: useProjectName(projectId)
- Location: src/hooks/useProjectName.js
- Returns: { projectName, loading, error }
- Client-side cache: In-memory 5‑minute TTL per projectId with in-flight request de-duplication to avoid duplicate network calls.
- Fallback behavior: If projectName is null or an error occurs, render a safe fallback (e.g., the raw project_id or “Unknown Project”).

Example usage in a Deployments table cell:
```jsx
import { useProjectName } from '../../hooks/useProjectName';

function ProjectNameCell({ projectId }) {
  const { projectName, loading, error } = useProjectName(projectId);

  if (loading) return <span title={projectId}>Resolving…</span>;
  if (error) return <span title={projectId}>{projectId}</span>;
  return <span title={projectId}>{projectName ?? projectId}</span>;
}
```

Notes
- The hook is SSR-safe and fetches on the client. It reads/writes a small in-memory cache scoped to the module and tab.
- The backend also maintains a 5‑minute in-memory cache and invalidates it on App Deployments CRUD, so subsequent calls are fast.

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
