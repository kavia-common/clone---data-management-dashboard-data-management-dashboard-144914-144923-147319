# Swagger/OpenAPI integration

- Spec is served at GET /openapi.json
- Swagger UI is available at GET /docs
- Static spec source: interfaces/openapi.json
- Mounting is handled in `swagger.js` via `mountSwagger(app)` which is called from `src/app.js`.
- If `interfaces/openapi.json` fails to parse, a minimal fallback spec is served so the server still boots.

Troubleshooting:
- If Swagger UI fails to load, validate interfaces/openapi.json (duplicate keys or invalid $ref are common).
- Ensure dependencies `swagger-ui-express` are installed (already in package.json).
