# Manual Verification: /api/project-create/summary

Steps:
1) Start the backend server (per README).
2) Run a GET request:
   curl -sS -H "x-organization-id: T0000" "http://localhost:3001/api/project-create/summary?range=daily"

Expected:
- HTTP 200
- JSON with { "success": true, "buckets": [ ... ] }

3) With project_id to test project_name enrichment:
   curl -sS -H "x-organization-id: T0000" "http://localhost:3001/api/project-create/summary?project_id=p1&range=daily"

Expected:
- HTTP 200
- JSON includes top-level "project_id": "p1" and "project_name": string|null
- Buckets elements include { project_id, project_name, label, count }

4) Optional dev verification helper:
   curl -sS -H "x-organization-id: T0000" "http://localhost:3001/api/dev/verify/project-create/summary?project_id=p1"

Expected:
- HTTP 200
- JSON with { ok: boolean, note: string, received: {...} }
