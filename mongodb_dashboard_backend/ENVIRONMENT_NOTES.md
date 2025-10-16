# Environment Notes

## Server

- PORT: Express server port. Defaults to 3001 if not set.
- HOST: Bind address. Defaults to 0.0.0.0.

The server exposes OpenAPI JSON at:
- http://localhost:${PORT}/openapi.json (e.g., http://localhost:3001/openapi.json)
- Swagger UI at http://localhost:${PORT}/docs

## MongoDB Connection

Set the following environment variables for correct DB selection and for /api/llm-costs to read from the proper collection:

- MONGODB_URI: Full MongoDB connection string (do not include dbName unless you want to hard-bind it).
- MONGODB_DB: Database name that contains the 'llm_costs' collection.

Example .env.example:
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster-host>/?retryWrites=true&w=majority
MONGODB_DB=your_database_name

## CORS

If your frontend runs on http://localhost:3000, ensure it is allowed. You can use any of:
- FRONTEND_ORIGIN=http://localhost:3000
- CORS_ORIGINS=http://localhost:3000,https://localhost:3000
If your frontend uses REACT_APP_API_BASE_URL, the origin will be inferred automatically.

## Verification steps

1. Start the backend and check logs:
   - Look for "[startup] Express listening on http://0.0.0.0:3001 ..." and DB connection logs.
2. Ensure your MongoDB database actually has documents in the 'llm_costs' collection.
3. Call:
   - GET http://localhost:3001/api/llm-costs
   - GET http://localhost:3001/api/llm-costs?page=1&limit=10
   Expect non-empty results when data exists.
4. Verify users trend:
   - GET http://localhost:3001/api/users/active-trend
