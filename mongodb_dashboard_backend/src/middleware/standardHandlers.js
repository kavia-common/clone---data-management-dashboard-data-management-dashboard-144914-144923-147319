'use strict';

/**
 * PUBLIC_INTERFACE
 * errorHandler
 * Re-export of the common Express JSON error handler so legacy imports
 * (./middleware/standardHandlers) continue to work without crashing
 * even if the original file location or export name changed.
 *
 * Usage:
 *   const { errorHandler } = require('./middleware/standardHandlers');
 *   app.use(errorHandler);
 */
const errorHandler = require('./errorHandler');

module.exports = {
  errorHandler,
};
