'use strict';

const { createApp } = require('./app');
const mongoose = require('mongoose');
const { connectDB, db } = require('./config/db');

// Default to 3001 to match container deployment and docs URL
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Create express app instance
const app = createApp();

// Attempt non-blocking DB connection; failures should not crash startup
(async () => {
  try {
    const { db: database } = await connectDB(console);
    // Attach db to app locals for health endpoints
    if (database) app.locals.db = database;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[startup] DB connect attempt failed (non-fatal):', e?.message || e);
  }
})();

const server = app
  .listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    const dbConn = db && db();
    const dbName = dbConn?.databaseName || 'disconnected';
    console.log(`[startup] Express listening on http://${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
    console.log(`[startup] DB: ${dbName}`);
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
      // Close mongoose if used elsewhere
      if (mongoose?.connection?.readyState === 1) {
        await mongoose.connection.close();
        // eslint-disable-next-line no-console
        console.log('Mongoose connection closed');
      }
      // Close native client via config/db close if available
      const { close } = require('./config/db'); // lazy require to avoid cycles
      if (typeof close === 'function') {
        await close(console);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error during shutdown', e);
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