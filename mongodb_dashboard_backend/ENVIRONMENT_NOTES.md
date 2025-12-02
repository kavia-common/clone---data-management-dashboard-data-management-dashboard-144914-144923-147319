# Backend environment notes

Important variables:
- PORT: default 3001
- HOST: default 0.0.0.0 (bind to all interfaces)
- BACKEND_PROTOCOL: http by default
- BACKEND_HOST: default localhost
- BACKEND_PORT: default same as PORT
- BACKEND_BASE_URL: constructed from protocol/host/port if not set

For constrained CI memory environments, npm scripts set:
NODE_OPTIONS=--max-old-space-size=2048

Use `npm run lint:strict` locally to enforce zero warnings. CI uses `npm run lint` which does not block builds on warnings.
