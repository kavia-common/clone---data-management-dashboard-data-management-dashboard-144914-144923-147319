const { createProxyMiddleware } = require("http-proxy-middleware");

/**
 * PUBLIC_INTERFACE
 * CRA dev server proxy.
 *
 * Proxies API calls and OpenAPI docs to the backend target to avoid mixed-content and CORS issues.
 * Target is chosen using:
 * - REACT_APP_API_BASE_URL or REACT_APP_API_URL if provided
 * - otherwise http://{REACT_APP_PROXY_HOST||localhost}:${REACT_APP_BACKEND_PORT || PORT || 3001}
 *
 * Notes:
 * - changeOrigin: true allows virtual hosted sites
 * - secure: false permits self-signed certs if target is https (dev only)
 *
 * Webpack Dev Server migration note:
 * - This project does not use onBeforeSetupMiddleware/onAfterSetupMiddleware here.
 * - CRA v5 uses http-proxy-middleware v2 which is compatible.
 */
module.exports = function setupProxy(app) {
  const port = process.env.REACT_APP_BACKEND_PORT || process.env.PORT || "3001";

  // Prefer explicit base URL
  const explicitBase =
    process.env.REACT_APP_API_BASE_URL || process.env.REACT_APP_API_URL;

  // In preview envs, the backend container is reachable at the same hostname as the frontend preview,
  // but on port 3001. Allow override via REACT_APP_PROXY_HOST to avoid hard-coded localhost.
  const inferredHost = process.env.REACT_APP_PROXY_HOST || "localhost";

  const target = explicitBase || `http://${inferredHost}:${port}`;

  const commonOpts = {
    target,
    changeOrigin: true,
    secure: false,
    logLevel: "warn",
    // Preserve host header so backend can build correct swagger server URL if needed
    onProxyReq: (proxyReq, req) => {
      if (!explicitBase && req && req.headers && req.headers.host) {
        // Set X-Forwarded-Host for diagnostics
        proxyReq.setHeader("x-forwarded-host", req.headers.host);
      }
    },
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

  // Also serve docs path to the backend if user opens /docs locally
  app.use(
    ["/api-docs", "/api/docs", "/docs"],
    createProxyMiddleware({
      ...commonOpts,
    })
  );
};
