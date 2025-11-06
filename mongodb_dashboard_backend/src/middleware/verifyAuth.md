This module is intentionally implemented via jwtAuth.js (verifyTenantAccess). Prefer importing from src/middleware (index.js) as:
  const { verifyAuth } = require('../middleware');
