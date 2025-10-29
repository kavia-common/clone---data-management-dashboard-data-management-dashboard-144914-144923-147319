# Cleanup Report - Remove User Analysis

Date: Auto

Changes:
- Removed all User Analysis endpoints, controllers, and services.
- src/routes/users.routes.js restored to baseline CRUD/listing + seed-if-empty only.
- Unmounted analysis routers from src/routes/index.js and src/app.js.
- Stubs (no-op) left for users.analytics.metrics.routes.js, usersAnalytics.routes.js, analytics.routes.js to prevent require errors.
- Removed implementations in:
  - src/controllers/users.analytics.controller.js
  - src/controllers/users.analytics.metrics.controller.js
  - src/controllers/usersAnalytics.controller.js
  - src/controllers/analytics.controller.js
  - src/services/analytics.js
  - src/services/analytics.users.newOverTime.service.js

API guarantee:
- /api/users supports page, limit, sort, filter and returns array or envelope.
- /api/users/:id get, POST/PUT/DELETE remain functional.
- No analysis query params or endpoints remain.

Frontend note:
- Ensure navigation and components do not call removed analysis endpoints.

