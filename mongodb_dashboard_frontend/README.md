# MongoDB Dashboard Frontend (React)

Modern, modular React dashboard styled with the "Ocean Professional" theme to manage data via an Express.js API.

## Highlights

- No authentication required: the dashboard loads directly for all users.
- Collections: Users, Session Tracking, App Deployments — CRUD UIs with modals and data tables.
- Charts: KPI/area charts and status bar charts for overview/trends.
- Theming: Blue primary and amber accents, subtle gradients, rounded surfaces.
- API Integration: Axios instance with interceptors, environment‑based base URL, standardized helpers.
- Structure: Clean separation of pages, components, routes, and API client.

## Development proxy configuration

To avoid proxy EADDRNOTAVAIL in preview/remote environments:
- Recommended: Set `REACT_APP_API_BASE_URL` to the full backend URL.
  - Example for local: `REACT_APP_API_BASE_URL=http://localhost:3001`
  - Example for preview: `REACT_APP_API_BASE_URL=https://<your-preview-host>:3001`
- Or set `REACT_APP_PROXY_HOST` and `REACT_APP_BACKEND_PORT` (defaults are `localhost` and `3001`) for setupProxy-based inference.
The backend binds on `0.0.0.0:3001`, so ensure your chosen host resolves to the backend container.

## Webpack Dev Server deprecation

This project uses Create React App v5 with http-proxy-middleware v2. We do not use the deprecated
`onBeforeSetupMiddleware`/`onAfterSetupMiddleware` hooks in our setupProxy, so no migration is necessary.

## Quickstart

1) Install dependencies
- npm install

2) Configure environment
- Copy .env.example to .env and set:
  - `REACT_APP_API_BASE_URL` (recommended in cloud preview), e.g.:
    `https://<your-preview-host>:3001`
  - Optional: `REACT_APP_API_PREFIX` (default `/api`)

3) Run the app
- npm start

App will run at http://localhost:3000 (or your environment's preview URL)

### Verify backend connectivity
- If using environment base URL:
  - API base resolves to `${REACT_APP_API_BASE_URL}${REACT_APP_API_PREFIX || '/api'}`
- If using dev proxy (no REACT_APP_API_BASE_URL set):
  - API calls go to `/api` and are proxied by `src/setupProxy.js` to the backend.
- Backend OpenAPI for sanity checks: `/openapi.json` (proxied) or open backend docs directly.

## Environment Variables

The frontend supports two variable names for the backend base URL (either is fine):
- `REACT_APP_API_URL`: Backend API root (takes precedence if set)
- `REACT_APP_API_BASE_URL`: Backend API root (recommended)

Other variables:
- `REACT_APP_API_PREFIX`: API prefix used by the backend. Default: `/api`
- `REACT_APP_BACKEND_PORT`: Used for auto-detection when REACT_APP_API_BASE_URL is not set. Default: `3001`
- `REACT_APP_PROXY_HOST`: Hostname used by setupProxy when inferring target (avoid hardcoding localhost in preview)
- `REACT_APP_DANGEROUSLY_DISABLE_HOST_CHECK`: If your environment requires relaxing host checks in dev tooling

Setup steps:
- Copy .env.example to .env
- For local dev:
  - `REACT_APP_API_BASE_URL=http://localhost:3001`
- For cloud preview (example):
  - `REACT_APP_API_BASE_URL=https://<your-preview-host>:3001`

Notes:
- Do not commit .env; use .env.example as reference.
- If you encounter “Network Error” from Axios, verify:
  1) The backend is reachable at the configured URL (open it in the browser)
  2) The port matches your backend server port (default 3001)
  3) CORS is allowed by the backend (or access via same-origin proxy)
  4) The API prefix matches your backend (default /api)
  5) In preview, avoid hardcoded localhost; use the preview hostname

## Proxy and HTTPS

In secure preview environments (https), browsers will block http requests to a backend (mixed content). To prevent this, the app includes a development proxy:

- src/setupProxy.js forwards:
  - /api -> backend (http://localhost:3001 by default, or as per env)
  - /openapi.json -> backend
  - /api-docs, /api/docs, /docs -> backend docs routes
- If REACT_APP_API_BASE_URL is NOT set, the API client typically uses a relative base (/api), which the dev server proxies to the backend.
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

Adjust src/api client paths accordingly if your backend differs.

## Accessibility and Security

- Keyboard-accessible modals and buttons
- If your backend requires authentication, wire it in your API gateway/reverse proxy as needed; the UI does not enforce auth.

## Testing

- CRA testing setup is included; extend tests in src/.
