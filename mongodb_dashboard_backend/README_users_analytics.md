# Users Analytics Endpoints (v2)

Base path: `/api/users/analytics`

Endpoints:
- GET `/activity-trends` — DAU/WAU/MAU and daily time series (uses `updated_at` as activity proxy).
- GET `/growth` — New users by day/week/month with growth rate (uses `created_at`).
- GET `/activity-breakdown` — Active users by department and by organization.
- GET `/inactivity` — Inactivity thresholds (gt7/14/30/60/90 days) and active/inactive ratio.
- GET `/compliance` — Acceptance percent and average time-to-accept (requires `accepted_at` if tracked).
- GET `/retention-cohorts` — Monthly cohorts with 7/30/90-day active rates.
- GET `/top-active-users` — Top users by most recent `updated_at`.

Filters: `organization_id`, `department`, `status`, `from`, `to`, and optional `granularity`/`limit` where applicable.

Defaults:
- Engagement endpoints default to `status=active` when not provided.

Date handling:
- UTC. `from` inclusive; `to` exclusive for bucketing; daily bounds normalized.

Indexes recommended:
- `users`: `{ updated_at: 1 }`, `{ created_at: 1 }`, `{ organization_id: 1 }`, `{ department: 1 }`.
- Optional compounds for high-cardinality tenants: `{ organization_id: 1, updated_at: -1 }`.

MongoDB connection:
- Uses existing `src/config/db.js` connection and environment configuration.
- Ensure `.env` provides the MongoDB URI according to project convention (e.g., `MONGODB_URI` or the configured variable used by db.js).
