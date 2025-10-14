const { createProxyMiddleware } = require("http-proxy-middleware");

/**
 * PUBLIC_INTERFACE
 * CRA dev server proxy.
 *
 * Proxies API calls and OpenAPI docs to the backend target to avoid mixed-content and CORS issues.
 * Target is chosen using:
 * - REACT_APP_API_BASE_URL or REACT_APP_API_URL if provided
 * - otherwise http://localhost:${REACT_APP_BACKEND_PORT || 3001}
 *
 * Notes:
 * - changeOrigin: true allows virtual hosted sites
 * - secure: false permits self-signed certs if target is https (dev only)
 */
module.exports = function setupProxy(app) {
  const port = process.env.REACT_APP_BACKEND_PORT || "3001";
  const target =
    process.env.REACT_APP_API_BASE_URL ||
    process.env.REACT_APP_API_URL ||
    `http://localhost:${port}`;

  const commonOpts = {
    target,
    changeOrigin: true,
    secure: false,
    logLevel: "warn",
  };

  // Proxy API prefix
  app.use(
    "/api",
    createProxyMiddleware({
      ...commonOpts,
    })
  );

  // Proxy OpenAPI spec for connectivity/health checks
  app.use(
    "/openapi.json",
    createProxyMiddleware({
      ...commonOpts,
    })
  );
};
