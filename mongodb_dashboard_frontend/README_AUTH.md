Authentication setup notes:

- Public login page: /login
- API base URL is read from environment variable REACT_APP_API_BASE_URL
  Example:
    REACT_APP_API_BASE_URL=https://kaviaqa-worktool.cloud.kavia.ai

- Required secret salt for organization id (used as organization_id in login):
    REACT_APP_SECRET_SALT=<your-url-safe-base64-salt-no-padding>
  Notes:
    - Must be URL-safe base64 (A-Za-z0-9-_), no '=' padding, length >= 16 after normalization.
    - Do NOT hardcode salts in code. Provide via environment only.
    - The app no longer uses insecure defaults. Missing/invalid salt will surface only when auth features are used, not at initial render.

- Session storage:
  localStorage.setItem('auth', JSON.stringify({ loggedIn: true, token? }))

- Protected routes are gated via <ProtectedRoute> wrapper in src/routes/AppRoutes.jsx
- On successful login, user is redirected to the intended route (location.state.from) or /dashboard by default.
