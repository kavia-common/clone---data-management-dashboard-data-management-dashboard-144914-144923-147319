# LLM Costs Endpoints - Timeout Prevention Notes

PUBLIC_INTERFACE
This document explains backend behavior to prevent gateway timeouts for LLM cost endpoints.

- Endpoints:
  - GET /api/llm-costs (primary list)
  - GET /api/projects/:projectId/llm-costs (deprecated alias)
  - GET /api/llm-costs/hierarchy (aggregation endpoint)

What changed:
- When clients do NOT pass explicit pagination parameters (page, limit), the backend now defaults to:
  - page=1
  - limit=100
  - sort=-timestamp (indexed-friendly)
- This defaulting is applied in both the public and the primary llm-costs routers before delegating to the generic controller.
- The generic controller also hard-clamps page size and prioritizes indexed sorts.

Why:
- Large result sets without pagination can overwhelm the DB and API gateway, leading to 504 gateway timeouts.
- Default pagination keeps responses responsive and predictable.

Client guidance:
- Prefer explicit pagination for data tables (e.g., page=1&limit=50).
- Use an indexed sort field (timestamp, created_at, or _id).
- For big data visualizations prefer dedicated aggregate endpoints (e.g., /api/analytics/llm-cost-by-agent or /api/llm-costs/hierarchy) instead of fetching raw records.

Diagnostics:
- Responses may include headers:
  - X-Pagination-Defaulted: true when the server applied defaults
  - X-Applied-Tenant: the resolved tenant
  - X-Applied-Filter: the enforced tenant filter
