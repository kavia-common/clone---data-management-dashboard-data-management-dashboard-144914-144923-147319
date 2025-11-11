'use strict';

const { createApp } = require('./app');
const mongoose = require('mongoose');
const { connect, db } = require('./config/db');

/**
 * Determine if env PORT was explicitly provided by the user (not just defaulted).
 * We consider it explicit if process.env.PORT is a non-empty string.
 */
const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '0.0.0.0';
const HOST = process.env.HOST || DEFAULT_HOST;
const envPortRaw = process.env.PORT;
const envPortExplicit = typeof envPortRaw === 'string' && envPortRaw.trim() !== '';
const initialPort = envPortExplicit ? Number(envPortRaw) : DEFAULT_PORT;

// Create express app instance
const app = createApp();

// Attempt non-blocking DB connection; failures should not crash startup
(async () => {
  try {
    const { db: database } = await connect(console);
    // Attach db to app locals for health endpoints
    if (database) app.locals.db = database;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[startup] DB connect attempt failed (non-fatal):', e?.message || e);
  }
})();

/**
 * Try to bind the server with small retry for transient errors.
 * If EADDRINUSE occurs:
 *  - when env PORT was explicitly set -> log clear message and exit(1) (preserve current behavior)
 *  - when env PORT was not set       -> increment port and retry until a free port is found (up to a cap)
 */
function startListening({ host, port, maxRetries = 2, tryCount = 0 }) {
  return new Promise((resolve, reject) => {
    const server = app
      .listen(port, host, () => {
        // eslint-disable-next-line no-console
        const dbConn = db && db();
        const dbName = dbConn?.databaseName || 'disconnected';
        console.log(`[startup] Express listening on http://${host}:${port} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
        console.log(`[startup] DB: ${dbName}`);
        resolve(server);
      })
      .on('error', async (err) => {
        // 'EADDRINUSE' -> port busy; 'EACCES' -> permission; 'EADDRNOTAVAIL' -> bad host; 'ECONNRESET' transient etc.
        if (err && err.code === 'EADDRINUSE') {
          if (envPortExplicit) {
            console.error(`[startup] Port ${port} is already in use and PORT was explicitly set via env. Exiting.`);
            process.exit(1);
          } else {
            // Auto-increment to next port when not explicitly set
            const nextPort = port + 1;
            if (nextPort > DEFAULT_PORT + 50) {
              console.error(`[startup] Unable to find a free port in range ${DEFAULT_PORT}-${DEFAULT_PORT + 50}. Exiting.`);
              process.exit(1);
            }
            console.warn(`[startup] Port ${port} in use. Trying next port ${nextPort}...`);
            resolve(startListening({ host, port: nextPort, maxRetries, tryCount: 0 }));
            return;
          }
        }

        // Retry a couple of times for transient errors
        if (tryCount < maxRetries && (!err || err.code !== 'EADDRINUSE')) {
          const delayMs = 250 * (tryCount + 1);
          console.warn(`[startup] Transient error on listen (attempt ${tryCount + 1}/${maxRetries}). Retrying in ${delayMs}ms...`, err?.code || err?.message || err);
          setTimeout(() => {
            resolve(startListening({ host, port, maxRetries, tryCount: tryCount + 1 }));
          }, delayMs);
          return;
        }

        console.error('[startup] Server failed to start:', err);
        reject(err);
      });
  });
}

let server;

// Kickoff startup
startListening({ host: HOST, port: initialPort })
  .then((s) => {
    server = s;
  })
  .catch((err) => {
    // If we reach here, it's a hard failure; exit so orchestrator/CI can restart
    process.exit(1);
  });

// Graceful shutdown
const shutdown = (signal) => {
  // eslint-disable-next-line no-console
  console.log(`${signal} signal received: closing HTTP server`);
  if (!server) {
    // server not bound or failed; still attempt DB shutdown
    (async () => {
      try {
        if (mongoose?.connection?.readyState === 1) {
          await mongoose.connection.close();
          console.log('Mongoose connection closed');
        }
        const { close } = require('./config/db');
        if (typeof close === 'function') {
          await close(console);
        }
      } catch (e) {
        console.error('Error during shutdown', e);
      }
      process.exit(0);
    })();
    return;
  }

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