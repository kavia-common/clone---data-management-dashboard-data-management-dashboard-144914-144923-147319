/* Ensure environment variables from .env are loaded even if the process
 * is started without "-r dotenv/config" (e.g., by external orchestrators).
 * This guarantees preview/CI can boot without special node flags.
 */
try { require('dotenv').config(); } catch {}

/**
 * PUBLIC_INTERFACE
 * Server entry point. Binds to 0.0.0.0 by default and uses PORT=3001 when env is missing.
 * Does not block startup on DB connection. Exports the server instance.
 */
const app = require('./app');
const mongoose = require('mongoose');

/**
 * Resolve port from environment with fallbacks.
 * We prefer PORT, but also accept common alternatives used by preview/orchestrators.
 */
const envPortRaw =
  process.env.PORT ??
  process.env.BACKEND_PORT ??
  process.env.EXPRESS_PORT ??
  process.env.SERVER_PORT ??
  process.env.APP_PORT;

const PORT = Number(envPortRaw) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Defensive: ensure PORT is a positive integer
const normalizedPort = Number.isFinite(PORT) && PORT > 0 ? PORT : 3001;

/**
 * Attempt to find an available port starting from a base port.
 * Only used when no explicit PORT env var is provided (dev/preview ergonomics).
 */
const pickAvailablePort = async (basePort, maxTries = 20) => {
  const net = require('net');
  const tryPort = (p) =>
    new Promise((resolve) => {
      const srv = net
        .createServer()
        .once('error', () => resolve(false))
        .once('listening', () => srv.close(() => resolve(true)))
        .listen(p, '0.0.0.0');
    });

  for (let i = 0; i <= maxTries; i += 1) {
    const p = basePort + i;
    // eslint-disable-next-line no-await-in-loop
    const ok = await tryPort(p);
    if (ok) return p;
  }
  return basePort;
};

const hasExplicitPortEnv = envPortRaw != null && String(envPortRaw).trim() !== '';

const startServer = async () => {
  const portToUse = hasExplicitPortEnv
    ? normalizedPort
    : await pickAvailablePort(normalizedPort);

  // Early startup banner to aid diagnostics
  try {
    // eslint-disable-next-line no-console
    console.log(
      `[startup] Initializing server on ${HOST}:${portToUse} (NODE_ENV=${process.env.NODE_ENV || 'development'})`
    );
    if (!hasExplicitPortEnv && portToUse !== normalizedPort) {
      // eslint-disable-next-line no-console
      console.log(
        `[startup] Port ${normalizedPort} was busy; selected available port ${portToUse} (set PORT to pin a specific port).`
      );
    }
  } catch {}

  // Start listening unconditionally; Mongo connection is handled inside app.js and must not block server startup.
  return app.listen(portToUse, HOST, () => {
    try {
      const dbName =
        mongoose?.connection?.db?.databaseName ||
        process.env.MONGODB_DB ||
        '(not connected)';
      // eslint-disable-next-line no-console
      console.log('[startup] Express is starting with DB:', dbName);
    } catch {
      // ignore logging failure
    }
    // eslint-disable-next-line no-console
    console.log(
      `[ready] Server listening on http://${HOST}:${portToUse} (ENV=${process.env.NODE_ENV || 'development'})`
    );
    // Emit an explicit readiness banner the preview system can scrape
    try {
      console.log(`[ready] Health endpoint: http://${HOST}:${portToUse}/health`);
      console.log(`[ready] Docs endpoint:   http://${HOST}:${portToUse}/api-docs`);
    } catch {}
    try {
      // Helpful hint: echo how to curl health and docs
      console.log(`[startup] Health: curl http://127.0.0.1:${portToUse}/health`);
      console.log(`[startup] Swagger UI: http://127.0.0.1:${portToUse}/api-docs`);
    } catch {}
  });
};

let server;
startServer()
  .then((s) => {
    server = s;
    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        // eslint-disable-next-line no-console
        console.error(
          `[startup] Port in use. If you need a specific port, set PORT explicitly. Details: ${err.message}`
        );
      } else {
        // eslint-disable-next-line no-console
        console.error('[startup] Server failed to start:', err);
      }
      process.exit(1);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[startup] Failed to initialize server:', err);
    process.exit(1);
  });

// Graceful shutdown
const shutdown = (signal) => {
  // eslint-disable-next-line no-console
  console.log(`${signal} signal received: closing HTTP server`);
  if (!server) process.exit(0);
  server.close(async () => {
    // eslint-disable-next-line no-console
    console.log('HTTP server closed');
    try {
      await mongoose.connection.close();
      // eslint-disable-next-line no-console
      console.log('MongoDB connection closed');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error closing MongoDB connection', e);
    }
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Log unexpected errors to avoid silent crashes during startup/runtime
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[uncaughtException]', err);
});

module.exports = server;