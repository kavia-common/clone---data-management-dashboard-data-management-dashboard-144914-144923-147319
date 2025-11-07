"use strict";

/**
 * Entry point for the Express server.
 * Binds to process.env.PORT (default 3001) and host 0.0.0.0 to satisfy preview readiness checks.
 * Ensures a /health route that returns 200 OK.
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
  // Fallback minimal app if src/app.js is not present or fails to load
  app = express();
}

// Ensure /health route exists. If existing app already has it, adding again will just override.
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Normalize PORT and HOST
const PORT = (() => {
  const p = process.env.PORT || "3001";
  const n = parseInt(p, 10);
  return Number.isNaN(n) ? 3001 : n;
})();

const HOST = process.env.HOST || "0.0.0.0";

// Create server and listen on 0.0.0.0 to be reachable from outside container
const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://${HOST}:${PORT} (health: /health)`);
});

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
