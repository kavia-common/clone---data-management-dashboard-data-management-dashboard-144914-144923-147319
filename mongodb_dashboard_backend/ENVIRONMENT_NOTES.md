# Backend environment and startup notes

- Server binds to HOST (default 0.0.0.0) and PORT (default 3001).
- Key routes for readiness:
  - GET /health -> 200 JSON { status: "ok", db: "connected|connecting|disconnected" }
  - GET /api/health -> same payload; safe for probes
- Scripts:
  - npm run dev  -> nodemon, HOST=0.0.0.0, PORT=3001
  - npm start    -> production node, HOST=0.0.0.0, PORT=3001
  - npm run health -> local probe curl http://127.0.0.1:3001/health

Environment variables to set via .env (do not hardcode in code):
- MONGODB_URI=<your connection string>
- AUTH_TENANT_SALT / SECRET_SALT (if required by auth)
- SWAGGER_* (optional)

Do not commit .env. Provide .env via deployment configuration.
