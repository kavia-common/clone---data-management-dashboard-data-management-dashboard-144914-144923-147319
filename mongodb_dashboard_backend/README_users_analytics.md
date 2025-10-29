# Users Analytics Endpoints

Mounted under /api/users/analytics:

- GET /overview
- GET /daily-active?days=30&start_date=&end_date=&department=&organization_id=
- GET /by-department?windowDays=14&start_date=&end_date=&department=&organization_id=
- GET /active-vs-inactive?windowDays=14&start_date=&end_date=&department=&organization_id=
- GET /top-active?limit=10&windowDays=30&start_date=&end_date=&department=&organization_id=
- GET /growth?days=30&start_date=&end_date=&department=&organization_id=

All responses are chart-friendly with ISO date formatting where applicable. Uses native MongoDB driver with indexes created at startup.
