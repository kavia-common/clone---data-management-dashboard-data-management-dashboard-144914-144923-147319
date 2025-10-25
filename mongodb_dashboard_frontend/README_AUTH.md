Authentication setup notes:

- Public login page: /login
- API base URL is read from environment variable REACT_APP_API_BASE_URL
  Example:
    REACT_APP_API_BASE_URL=https://kaviaqa-worktool.cloud.kavia.ai

- Optional encryption salt for organization id:
    REACT_APP_TENANT_ENCRYPTION_SALT=<your-salt-here>
  For production, do not hardcode salts in code. Provide via environment.

- Session storage:
  localStorage.setItem('auth', JSON.stringify({ loggedIn: true, token? }))

- Protected routes are gated via <ProtectedRoute> wrapper in src/routes/AppRoutes.jsx
- On successful login, user is redirected to the intended route (location.state.from) or /dashboard by default.
