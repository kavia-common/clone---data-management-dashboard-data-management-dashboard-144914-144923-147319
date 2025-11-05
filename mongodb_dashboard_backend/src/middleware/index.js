'use strict';

// Central export for all middlewares
module.exports = {
  // Existing groups (some may be empty pass-throughs depending on project)
  ...require('./auth'),
  ...require('./jwtAuth'),
  ...require('./security'),
  ...require('./standardHandlers'),
  ...require('./tenantContext'),
  ...require('./validators'),

  // Newly added tenant-aware auth middlewares
  ...require('./verifyAuth'),
  ...require('./requireTenant'),
};
