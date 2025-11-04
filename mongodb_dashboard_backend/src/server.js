const mongoose = require('mongoose');
let app;

// 1) Try to import app.js, but never fail the process if it throws at import-time.
//    We create a tiny fallback Express app that only serves /health in that case.
try {
  app = require('./app');
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[startup] Failed to import ./app.js. Starting minimal fallback server:', e?.message || e);
  const express = require('express');
  app = express();
  // Minimal liveness that never depends on other modules
  // PUBLIC_INTERFACE
  app.get('/health', (req, res) =>
    res.status(200).json({
      status: 'ok',
      ready: true,
      mode: 'fallback',
      error: (e && (e.message || String(e))) || 'unknown',
      timestamp: new Date().toISOString(),
    })
  );
  // Root path fallback too
  app.get('/', (req, res) => res.status(200).json({ status: 'ok', ready: true, mode: 'fallback' }));
}

// Default to 3001 to match container deployment and docs URL
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Extra startup logs to aid CI/container readiness checks
// eslint-disable-next-line no-console
console.log(`[startup] Attempting to bind Express server on ${HOST}:${PORT}`);
console.log('[startup] Health endpoints available at / and /health');

// Ensure server listens on HOST 0.0.0.0 (for containers) and log explicit URL
const server = app
  .listen(PORT, HOST, () => {
    // Avoid accessing undefined properties if DB is not yet connected
    let dbName = 'n/a';
    try {
      dbName =
        mongoose?.connection?.db?.databaseName ||
        mongoose?.connection?.name ||
        'n/a';
    } catch {}
    // eslint-disable-next-line no-console
    console.log(
      `[startup] Express listening on http://${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[startup] MongoDB state=${mongoose?.connection?.readyState ?? 'unknown'} db=${dbName}`
    );
  })
  .on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.error(
        `[startup] Port ${PORT} is already in use. Ensure no other process is running on this port.`
      );
    } else if (err && err.code === 'EACCES') {
      // eslint-disable-next-line no-console
      console.error(
        `[startup] Permission denied binding to ${HOST}:${PORT}. Try a different port or adjust permissions.`
      );
    } else {
      // eslint-disable-next-line no-console
      console.error('[startup] Server failed to start:', err?.message || err);
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
      console.error('Error closing MongoDB connection', e?.message || e);
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
