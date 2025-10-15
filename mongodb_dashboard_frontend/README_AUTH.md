Authentication setup notes:

- Public login page: /login
- API base URL is read from environment variable REACT_APP_API_BASE_URL
  Example:
    REACT_APP_API_BASE_URL=https://kaviaqa-worktool.cloud.kavia.ai

- Tenant encryption salt (URL-safe base64 without padding) can be provided via:
    REACT_APP_SECRET_SALT=<your-url-safe-base64-salt>
  For production, do not hardcode salts in code. Provide via environment. If not provided,
  the frontend will attempt to fetch a public-safe encrypted token from the backend at runtime
  and cache it locally.

- Session storage:
  localStorage.setItem('auth', JSON.stringify({ loggedIn: true, token? }))

- Protected routes are gated via <ProtectedRoute> wrapper in src/routes/AppRoutes.jsx
- On successful login, user is redirected to the intended route (location.state.from) or /dashboard by default.
