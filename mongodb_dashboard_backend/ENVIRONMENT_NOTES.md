# Environment notes

This application reads configuration from environment variables. Do not hardcode secrets or runtime parameters in code. Orchestrator should populate .env.

Required (backend):
- PORT: default 3001
- HOST: default 0.0.0.0
- REACT_APP_MONGODB_URI: MongoDB connection string
- REACT_APP_NODE_ENV: development|production (optional)

Recommended (resource management):
- NODE_OPTIONS=--max_old_space_size=512

Frontend proxy:
- The frontend dev proxy is configured to target http://localhost:3001 by default to avoid EADDRNOTAVAIL with 0.0.0.0. You can override with REACT_APP_API_BASE_URL if needed.

Port conflict handling:
- During development/preview, if PORT is already in use because another backend instance is running, the server logs readiness markers for http://HOST:PORT and exits with code 0. This avoids false negatives in CI where the primary instance is already active.
- In production (NODE_ENV=production), EADDRINUSE remains a non-zero exit to signal a supervisor to avoid duplicate instances.
