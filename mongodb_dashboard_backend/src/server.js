/* Ensure environment variables from .env are loaded even if the process
 * is started without "-r dotenv/config" (e.g., by external orchestrators).
 * This guarantees preview/CI can boot without special node flags.
 */
try { require('dotenv').config(); } catch {}

const app = require('./app');
const mongoose = require('mongoose');

// Default to 3001 to match container deployment and docs URL
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Early startup banner to aid diagnostics
try {
  // eslint-disable-next-line no-console
  console.log(`[startup] Initializing server on ${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
} catch {}

// Start listening unconditionally; Mongo connection is handled inside app.js and must not block server startup.
const server = app
  .listen(PORT, HOST, () => {
    try {
      const ready = mongoose.connection?.readyState ?? 0;
      const dbName = mongoose.connection?.name || '(not connected yet)';
      const dbState = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
      const baseUrl = `http://${HOST}:${PORT}`;
      // Use exactly this phrasing to signal readiness to preview/CI
      console.log(`[startup] Express listening on ${baseUrl} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
      console.log('[startup] Ready: health endpoint at GET /health');
      console.log(`[startup] MongoDB state=${dbState} db=${dbName}`);
      // Helpful direct links for preview
      console.log(`[startup] Health:     ${baseUrl}/health`);
      console.log(`[startup] OpenAPI:    ${baseUrl}/openapi.json`);
      console.log(`[startup] Swagger UI: ${baseUrl}/api-docs (alias: /docs)`);
    } catch {
      // Best-effort logs; avoid throwing in callback
      // eslint-disable-next-line no-console
      console.log(`[startup] Express listening on http://${HOST}:${PORT}`);
    }
  })
  .on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.error(`[startup] Port ${PORT} is already in use. Ensure no other process is running on this port.`);
    } else {
      // eslint-disable-next-line no-console
      console.error('[startup] Server failed to start:', err);
    }
    // Exit so orchestrator/CI can restart
    process.exit(1);
  });

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
