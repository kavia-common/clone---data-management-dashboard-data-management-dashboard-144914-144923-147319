# Backend run/build hardening summary

- Scripts hardened to avoid early termination and reduce memory usage.
- No frontend/webpack dev server is started by backend.
- NODE_OPTIONS memory limit set to 512MB.
- Lint/test configured for CI (non-watch, no blocking on warnings).
- Browserslist update warnings suppressed to avoid noisy exit.

Use:
- npm run dev
- npm start
- npm run health
