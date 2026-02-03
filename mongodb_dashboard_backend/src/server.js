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

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Defensive: ensure PORT is a positive integer
const normalizedPort = Number.isFinite(PORT) && PORT > 0 ? PORT : 3001;

/**
 * Attempt to listen on `startPort`, and if it's already in use, automatically
 * try the next ports. This prevents preview/orchestrator readiness failures
 * when a stale process is still bound to the default port (3001).
 */
function listenWithPortFallback(startPort, maxAttempts = 10) {
  let currentPort = startPort;
  let attemptsLeft = maxAttempts;

  const banner = () => {
    try {
      // eslint-disable-next-line no-console
      console.log(
        `[startup] Initializing server on ${HOST}:${currentPort} (NODE_ENV=${process.env.NODE_ENV || 'development'})`
      );
    } catch {}
  };

  banner();

  const server = app.listen(currentPort, HOST, () => {
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
      `[ready] Server listening on http://${HOST}:${currentPort} (ENV=${process.env.NODE_ENV || 'development'})`
    );

    // Emit explicit readiness pointers (useful for preview health probes)
    try {
      console.log(`[ready] Health endpoint: http://${HOST}:${currentPort}/health`);
      console.log(`[ready] Docs endpoint:   http://${HOST}:${currentPort}/api-docs`);
      console.log(`[startup] Health: curl http://127.0.0.1:${currentPort}/health`);
      console.log(`[startup] Swagger UI: http://127.0.0.1:${currentPort}/api-docs`);
    } catch {}
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[startup] Port ${currentPort} is already in use; trying ${currentPort + 1}...`
      );
      attemptsLeft -= 1;
      currentPort += 1;
      // Close this server handle and retry.
      try {
        server.close(() => listenWithPortFallback(currentPort, attemptsLeft));
      } catch {
        listenWithPortFallback(currentPort, attemptsLeft);
      }
      return;
    }

    // eslint-disable-next-line no-console
    console.error('[startup] Server failed to start:', err);
    // Exit so orchestrator/CI can restart if we cannot recover.
    process.exit(1);
  });

  return server;
}

// Start listening; Mongo connection is handled inside app.js and must not block server startup.
const server = listenWithPortFallback(normalizedPort, 10);

// Graceful shutdown
const shutdown = (signal) => {
  // eslint-disable-next-line no-console
  console.log(`${signal} signal received: closing HTTP server`);
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