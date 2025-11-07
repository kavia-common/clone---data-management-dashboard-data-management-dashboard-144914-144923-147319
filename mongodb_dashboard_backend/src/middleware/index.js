/**
 * PUBLIC_INTERFACE
 * Middleware registry: export common middlewares for centralized imports if desired.
 */
module.exports = {
  // Auth
  verifyAuth: require('./verifyAuth').verifyAuth,
};
