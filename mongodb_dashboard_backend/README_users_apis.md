# Users APIs - Additional

## GET /api/users/:userId/projects

Returns distinct projects the user has activity in, based on the `session_tracking` collection.

Query parameters:
- tenant_id: required (alias organization_id)
- from: optional ISO date-time (inclusive)
- to: optional ISO date-time (inclusive)

Response:
{
  "user_id": "u1",
  "tenant_id": "org_123",
  "projects": [
    { "project_id": "projA", "project_name": "My App", "last_activity": "2025-01-10T10:30:00.000Z" }
  ]
}

Notes:
- userId is normalized to string for matching and matched against `user_id` or `userId`.
- tenant scope matches either `tenant_id` or legacy `organization_id`.
- last_activity is taken from the most recent of: last_updated, timestamp, session_end, session_start, created_at.
