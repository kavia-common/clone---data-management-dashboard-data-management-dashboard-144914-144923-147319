Login Flow Notes

- Set REACT_APP_API_BASE in .env (see .env.example). Default fallback is http://localhost:3001.
- The login form posts to /api/auth/login with { organization_id, email, password }.
- On success, a token is stored in localStorage as 'auth_token'. The app redirects to /overview.
- ProtectedRoute guards /overview and other routes; unauthenticated users are redirected to /login.
- To logout, use the Logout button in the Topbar (appears when authenticated).
