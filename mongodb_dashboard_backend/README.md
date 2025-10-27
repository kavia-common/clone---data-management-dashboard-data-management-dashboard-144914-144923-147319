# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Docs (Swagger UI): http://localhost:3001/docs
- OpenAPI JSON: http://localhost:3001/openapi.json

Environment example: see .env.example.

CORS
- Defaults allow localhost:3000.
- You can set FRONTEND_ORIGIN or CORS_ORIGINS or define REACT_APP_API_BASE_URL and we infer its origin.

Key route to verify:
- GET /api/users/active-trend (e.g., http://localhost:3001/api/users/active-trend)

## Authentication and Password Hashing (v1 → v2 migration)

This backend implements a versioned password hashing strategy with per-organization salts.

- v1 (legacy): static salt from environment (SECRET_SALT/AUTH_TENANT_SALT/PASSWORD_SALT). Used only for verification of existing hashes.
- v2 (current): per-organization dynamic salt stored on each Tenant document (`orgSalt`), plus optional global pepper (`AUTH_PASSWORD_PEPPER` or `AUTH_PEPPER`). Preferred algorithm is Argon2id if the `argon2` package is available, falling back to `bcrypt` if available, then to Node.js `scrypt` as a last resort.

On-Login Migration:
- When a user with a v1 hash logs in successfully, their password will be re-hashed immediately with v2 and updated in the database (online migration).
- If a user document has no `password_hash`, we preserve backward compatibility and allow login (placeholder token), so existing users are not broken.

Tenant Salt:
- New tenants automatically receive an `orgSalt` (base64) on creation.
- If a legacy tenant is missing `orgSalt`, it is generated automatically upon signup/login/reset operations.

New endpoints:
- POST /api/auth/signup { organization_id, email, password } → creates/updates a user with v2 hash.
- POST /api/auth/login { organization_id, email, password } → verifies and migrates v1→v2 when needed.
- POST /api/auth/reset-password { organization_id, email, password } → sets a new v2 hash (demo only; add token validation for production).

Security notes:
- Do not expose salts/peppers or any secrets in logs.
- Use strong values for SECRET_SALT and AUTH_PASSWORD_PEPPER in production.
- For production, implement JWTs signed with `AUTH_JWT_SECRET` and proper RBAC checks.

Deterministic user ID for stub auth:
- When using the placeholder token (`Authorization: Bearer ok`), the backend now derives a deterministic, URL-safe user id from a secret salt via HMAC-SHA256.
- Configure the secret via `AUTH_SECRET_SALT` in the environment. If not set, a built-in fallback is used for development only.
- The derived id is stable across restarts for the same salt and different across different salts. No raw secrets are logged.

## Analytics: LLM cost distribution by agent

GET /api/analytics/llm-cost-by-agent

Description:
- Aggregates the LLM costs collection by agent and sums total cost per agent.
- Returns a sorted array of objects: [{ agent: string, total_cost: number }], descending by total_cost.
- Values are rounded to 6 decimal places and returned as numbers (not strings).
- If no data exists, returns an empty array [].

Sample curl:
```bash
# Basic request
curl -s http://localhost:3001/api/analytics/llm-cost-by-agent | jq .

# Example response:
# [
#   { "agent": "GenerateDescriptionAgent", "total_cost": 1.234567 },
#   { "agent": "SummarizeAgent", "total_cost": 0.447605 }
# ]
```

Response example (200):
[
  { "agent": "GenerateDescriptionAgent", "total_cost": 1.234567 },
  { "agent": "SummarizeAgent", "total_cost": 0.447605 }
]

Notes:
- The service auto-detects plausible collections (llm-costs, llm_costs, llm_cost, logs, events, interactions, agentLogs) and supports both a flat schema (agent_name|agent|tool + total_cost|cost) and an Agents[] array schema with fields "Agent Name" and "Total Cost".
- Missing/empty agent names fall back to "Unknown".
- The aggregation strips leading '$' and commas from cost values and safely parses them to numbers.
- The implementation handles malformed or missing values safely and returns [] when no data.
- See /docs for OpenAPI details.
