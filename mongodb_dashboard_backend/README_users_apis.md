# Users APIs

This README lists user-related APIs and additive analytics endpoints.

Core Users:
- GET /api/users
- POST /api/users
- GET /api/users/{id}
- PUT /api/users/{id}
- DELETE /api/users/{id}
- GET /api/users/seed-if-empty
- GET /api/users/tenant-summary

Additive Analytics (new, backward compatible):
- GET /api/analytics/users/activity
- GET /api/analytics/users/summary

Notes:
- Analytics endpoints compute DAU/WAU/MAU and role-segmented activity using users.updated_at approximation without modifying existing routes.
