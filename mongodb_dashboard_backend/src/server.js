const app = require('./app');
const mongoose = require('mongoose');
const { connectDB } = require('./config/db');

// Default to 3001 to match container deployment and docs URL
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    // Attempt DB connect before listening. If it fails, we still can choose to start HTTP
    // to serve /health/db = down. For strict startup gating, set STARTUP_REQUIRE_DB=true.
    const requireDb = String(process.env.STARTUP_REQUIRE_DB || 'false').toLowerCase() === 'true';
    try {
      await connectDB();
      // eslint-disable-next-line no-console
      console.log('[startup] MongoDB ready');
    } catch (dbErr) {
      // eslint-disable-next-line no-console
      console.error('[startup] MongoDB connection failed on startup:', dbErr?.message || dbErr);
      if (requireDb) {
        process.exit(1);
      }
      // else continue; routes will surface 503 for DB-dependent operations
    }

    const server = app
      .listen(PORT, HOST, () => {
        // eslint-disable-next-line no-console
        console.log(
          `[startup] Express listening on http://${HOST}:${PORT} (NODE_ENV=${
            process.env.NODE_ENV || 'development'
          })`
        );
      })
      .on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
          // eslint-disable-next-line no-console
          console.error(
            `[startup] Port ${PORT} is already in use. Ensure no other process is running on this port.`
          );
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

    return server;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[startup] Fatal error during startup:', e);
    process.exit(1);
  }
}

module.exports = start();
