# MongoDB Dashboard Frontend (React)

Modern, modular React dashboard styled with the "Ocean Professional" theme to manage data via a secure Express.js API.

## Highlights

- Authentication: login/registration, token persistence, logout, protected routes.
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
  - REACT_APP_SITE_URL (public URL of this app, e.g., http://localhost:3000)

3) Run the app
- npm start

App will run at http://localhost:3000

## Project Structure

- src/
  - api/client.js — Axios client + API functions (login/register and CRUD for all collections)
  - auth/AuthContext.jsx — auth state, login/register/logout, Protected wrapper
  - components/
    - layout/ — Topbar, Sidebar, AppLayout
    - ui/ — Button, Modal, Card
    - charts/ — KPIChart (Recharts)
    - DataTable.jsx — generic table with sorting and actions
  - pages/
    - Login.jsx, Register.jsx
    - dashboard/Overview.jsx, Users.jsx, Sessions.jsx, Deployments.jsx
  - routes/AppRoutes.jsx — public + protected routes
  - App.js — root composition
  - App.css / index.css — Ocean Professional theme styles

## Environment Variables

- REACT_APP_API_BASE_URL: Backend API root (required)
- REACT_APP_SITE_URL: Public URL of this frontend (used for auth flows like email redirects)
Note: Do not commit .env; use .env.example as reference.

## API Endpoints

The frontend expects conventional REST endpoints:
- POST /auth/login { email, password } -> { token, user }
- POST /auth/register { name, email, password } -> { token, user }
- Users: GET/POST /users, PUT/DELETE /users/:id
- Sessions: GET/POST /session-tracking, PUT/DELETE /session-tracking/:id
- Deployments: GET/POST /app-deployments, PUT/DELETE /app-deployments/:id

Adjust src/api/client.js if your backend differs.

## Accessibility and Security

- Keyboard-accessible modals and buttons
- Authorization header applied automatically
- 401 response clears session to prevent stale tokens

## Customization

- Update colors and radii in App.css variables.
- Extend DataTable columns and forms based on your schema.
- Add pagination and server-side filters as your API supports them.

## Testing

- CRA testing setup is included; extend tests in src/.
