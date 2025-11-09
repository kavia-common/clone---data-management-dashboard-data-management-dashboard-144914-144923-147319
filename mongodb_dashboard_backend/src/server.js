const app = require('./app');
const mongoose = require('mongoose');

// Default to 3001 to match container deployment and docs URL
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

const server = app
  .listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log("CURRENTDB",mongoose.connection.db.databaseName);
    console.log(`[startup] Express listening on http://${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
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