# GET /api/llm-costs – Verification and Behavior

This endpoint lists LLM cost records from the `llm-costs` collection with tenant scoping, pagination, and performance guards.

Key behaviors:
- Tenant scoping required. Resolution order:
  1) Authorization bearer JWT (req.auth.tenantId)
  2) Header x-organization-id (or x-tenant-id, x-tenant)
  3) Query ?organization_id or ?tenant_id
- Default tenant: If none provided and not in bypass mode, the server defaults to organization_id=T0015 (unless DISABLE_DEFAULT_TENANT=true). This meets the verification requirement.
- Pagination defaults: page=1, limit=20; limit capped at 200.
- Performance guards: lean() queries, maxTimeMS=8000, indexed sort by -timestamp; indexes ensured on {tenant_id, timestamp} and {organization_id, timestamp}.
- Error handling:
  - 400 when tenant is missing and DISABLE_DEFAULT_TENANT=true
  - 403 when Authorization tenant conflicts with provided tenant hint
  - 504 when Mongo query times out (maxTimeMS exceeded)
  - All responses are structured { success, data, meta } for lists
- Headers:
  - X-Applied-Tenant: resolved tenant or "all-tenants" when bypassed (T0000)
  - X-Applied-Filter: the enforced filter (diagnostics)
  - X-Model-Collection: resolved collection name (llm-costs)

Environment variables required:
- MONGODB_URI: Mongo connection string (required for data)
- MONGODB_DB (optional): Explicit DB name override
- MONGOOSE_AUTO_INDEX (optional): 'true' to enable automatic index creation
- DISABLE_DEFAULT_TENANT (optional): set 'true' to disable default T0015 behavior

CORS and proxy:
- Server listens on 0.0.0.0 to avoid EADDRNOTAVAIL in proxied environments.
- Permissive CORS is enabled for /api/* with ACAO="*"; x-organization-id header is allowed and exposed.

Quick verification (no JWT):
curl -sS "http://localhost:3001/api/llm-costs?page=1&limit=10" -H "x-organization-id: T0015" -i

You should receive:
- HTTP/1.1 200 OK
- Headers: X-Applied-Tenant: T0015, X-Model-Collection: llm-costs
- Body: { "success": true, "data": [...], "meta": { "page": 1, "limit": 10, "total": <n> } }

If envs are missing:
- The API will start but /api/health will show db=disconnected, and /api/llm-costs will likely return empty data or 500 on DB operations.
- Set MONGODB_URI in your environment or .env file (handled by orchestrator).
