 /**
  * PUBLIC_INTERFACE
  * tryRequireRoute
  * Safely require and return an Express router module. If require fails, a fallback stub router
  * is returned that responds 200 JSON with a diagnostic payload so the server continues to boot.
  *
  * @param {string} modulePath - require path relative to caller (e.g., './routes/users.routes')
  * @param {object} options - { mountPath: string, label?: string }
  * @returns {function} Express Router
  */
function tryRequireRoute(modulePath, options = {}) {
  const label = options.label || modulePath;
  try {
    // dynamic require is acceptable in backend for route loading
    // eslint-disable-next-line global-require
    const router = require(modulePath);
    if (!router) {
      throw new Error('Module returned falsy router');
    }
    return router;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[routes:safe] Failed to load route module ${label}. Continuing with stub.`,
      err?.message || err
    );
    const express = require('express');
    const stub = express.Router();
    const pathInfo = options.mountPath ? ` (mounted at ${options.mountPath})` : '';
    /**
     * PUBLIC_INTERFACE
     * Stub route handler used when a module fails to load.
     */
    stub.all('*', (req, res) => {
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({
        success: true,
        stub: true,
        route: label,
        message: `Route module failed to load${pathInfo}. Returning stub response to avoid server crash.`,
      });
    });
    return stub;
  }
}

/**
 * PUBLIC_INTERFACE
 * buildStubRouter
 * Builds a basic stub router that returns 200 with a generic message. Useful as a fallback.
 */
function buildStubRouter(message = 'OK') {
  const express = require('express');
  const router = express.Router();
  router.all('*', (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, message, path: req.originalUrl });
  });
  return router;
}

module.exports = {
  // PUBLIC_INTERFACE
  tryRequireRoute,
  // PUBLIC_INTERFACE
  buildStubRouter,
};
