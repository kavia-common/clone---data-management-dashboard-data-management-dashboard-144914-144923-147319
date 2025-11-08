# Backend environment and readiness

- Default PORT is 3001 and HOST is 0.0.0.0.
- Use: npm run dev:node to start without nodemon in environments where nodemon is unavailable.
- Readiness endpoint: GET /health (independent of MongoDB).
- MongoDB connection is non-blocking; missing MONGODB_URI will not prevent server start. Health returns db=disconnected.
- For development without JWT secret, set ALLOW_DEMO_AUTH=true and send either:
  - Authorization: Bearer ok or any token, plus x-tenant-id header; or
  - No token, with ALLOW_DEMO_AUTH=true and x-tenant-id.
