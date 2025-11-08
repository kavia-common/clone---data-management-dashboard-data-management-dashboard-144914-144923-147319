# MongoDB Dashboard Backend

A minimal Express backend for the data management dashboard.

## Development

Start the server (binds to 0.0.0.0:3001 by default):
- npm run dev

Notes:
- Uses a plain Node process (no nodemon, no cross-env).
- src/server.js defaults HOST to 0.0.0.0 and PORT to 3001 if env vars are not provided.
- Health endpoints: GET /health (no DB dependency) and GET /api/health (reports DB status).
- The server listens on 0.0.0.0 so external preview can reach it.

## Environment

Copy .env.example to .env and set values as appropriate.

For MongoDB connectivity, set the following in your environment (do not commit secrets):
- MONGODB_URI=<your-connection-string>
- MONGODB_DB=<optional-db-name>

The server will still start without a database and report db=disconnected on /health. Database connection is attempted asynchronously and failures do not crash the server.
