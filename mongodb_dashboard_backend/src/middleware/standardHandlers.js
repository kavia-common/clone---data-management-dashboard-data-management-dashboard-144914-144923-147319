'use strict';

/**
 * PUBLIC_INTERFACE
 * errorHandler
 * Express error handling middleware returning JSON.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err && (err.status || err.statusCode) ? (err.status || err.statusCode) : 500;
  const message = err && err.message ? err.message : 'Internal Server Error';
  res.status(status).json({ success: false, message });
}

module.exports = { errorHandler };
