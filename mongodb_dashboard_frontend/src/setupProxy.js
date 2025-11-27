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
 */
module.exports = function setupProxy(app) {
  const port = process.env.REACT_APP_BACKEND_PORT || process.env.PORT || "3001";
  // Prefer explicit base URL if set; otherwise, infer from current host to avoid localhost/IP mismatch in preview
  let inferredHost = "localhost";
  try {
    // CRA proxy runs in node (dev server). We cannot access window here, but we can use the host header at runtime.
    // http-proxy-middleware will rewrite based on target; we'll keep protocol http for local dev.
    inferredHost = process.env.REACT_APP_PROXY_HOST || "localhost";
  } catch {}
  const target =
    process.env.REACT_APP_API_BASE_URL ||
    process.env.REACT_APP_API_URL ||
    `http://${inferredHost}:${port}`;

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
