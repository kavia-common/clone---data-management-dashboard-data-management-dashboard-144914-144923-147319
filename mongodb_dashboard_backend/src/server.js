"use strict";

/**
 * Entry point for the Express server.
 * Binds to process.env.PORT (default 3001) and host 0.0.0.0 to satisfy preview readiness checks.
 * Ensures a /health route that returns 200 OK.
 *
 * Environment expectations for preview:
 * - HOST=0.0.0.0
 * - PORT=3001
 * These are also the defaults when not provided.
 */

const http = require("http");
const express = require("express");

// Try to load existing app configuration if available (routes, middleware).
// If not found, fall back to a minimal app.
let app;
try {
  // Prefer existing app if it exports an Express app instance
  // This keeps all previously defined middleware/routes intact.
  // eslint-disable-next-line import/no-unresolved, global-require
  app = require("./app");
  if (typeof app !== "function" || !app.use) {
    // If app does not look like an express instance, create one and mount if possible
    app = express();
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`[startup] Failed to load ./app: ${err?.message || err}. Using minimal app.`);
  // Fallback minimal app if src/app.js is not present or fails to load
  app = express();
}

/**
 * Health endpoints:
 * - Prefer app's /health if already mounted; otherwise provide a minimal fallback.
 */
const fallbackHealth = (req, res) => res.status(200).json({ status: "ok", source: "server-fallback" });
try {
  // Probe if a /health handler exists by checking the stack; if not, mount fallback.
  const hasHealth =
    app && Array.isArray(app._router?.stack)
      ? app._router.stack.some((l) => l?.route?.path === "/health")
      : false;
  if (!hasHealth) {
    app.get("/health", fallbackHealth);
  }
} catch {
  app.get("/health", fallbackHealth);
}

// Normalize PORT and HOST
const PORT = (() => {
  const p = process.env.PORT || "3001";
  const n = parseInt(p, 10);
  return Number.isNaN(n) ? 3001 : n;
})();

const HOST = process.env.HOST || "0.0.0.0";

// Create server and listen on 0.0.0.0 to be reachable from outside container
const server = http.createServer(app);

// Listen error handling (e.g., EADDRINUSE)
server.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error(`[startup] HTTP server error: ${err?.code || "ERR"} ${err?.message || err}`);
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `[startup] Port ${PORT} is already in use on ${HOST}. ` +
      `If running in CI/preview, ensure stale processes are killed. Try npm run dev:force or start:ci.`
    );
  }
  // Surface fatal errors for CI visibility
  try {
    process.exitCode = 1;
  } finally {
    // give logs a moment to flush
    setTimeout(() => process.exit(1), 50);
  }
});

try {
  // eslint-disable-next-line no-console
  console.log(`[startup] Attempting to bind HTTP server on ${HOST}:${PORT} ...`);
  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`[startup] Server listening on http://${HOST}:${PORT}`);
    try {
      console.log(`[startup] Health endpoint ready at http://${HOST}:${PORT}/health`);
    } catch {}
  });
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[startup] Unexpected error during server.listen: ${err?.message || err}`);
  process.exit(1);
}

// Emit a brief readiness hint for CI logs
setTimeout(() => {
  // eslint-disable-next-line no-console
  console.log(`[startup] Ready check: visit http://127.0.0.1:${PORT}/health`);
}, 200);

// Graceful shutdown support
const shutdown = (signal) => {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    // eslint-disable-next-line no-console
    console.log("HTTP server closed.");
    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error("Forcing shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// PUBLIC_INTERFACE
module.exports = server;
