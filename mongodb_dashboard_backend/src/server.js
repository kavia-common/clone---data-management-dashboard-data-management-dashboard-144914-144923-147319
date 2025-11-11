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
const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';

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
 * EADDRINUSE handling:
 *  - Production (NODE_ENV=production): always hard exit so orchestrator/CI detects failure.
 *  - Non-production:
 *      - If PORT was explicitly set via env: log a clear warning and auto-increment to next available port,
 *        retrying up to a small cap so local dev doesn't crash. This preserves CI readiness when the requested
 *        port is available because we only fallback when it is actually busy.
 *      - If PORT was not set: also auto-increment from default port.
 */
function startListening({ host, port, maxRetries = 2, tryCount = 0, eaddrAttempts = 0, eaddrMax = 5 }) {
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
          if (isProduction) {
            console.error(`[startup] Port ${port} is already in use (production). Exiting with failure.`);
            return reject(err);
          }
          // Development behavior: auto-increment regardless of explicit PORT, with a clear message
          const nextPort = port + 1;
          if (eaddrAttempts + 1 > eaddrMax) {
            console.error(`[startup] Unable to find a free port after ${eaddrMax} attempts starting from ${initialPort}. Exiting.`);
            return reject(err);
          }
          if (envPortExplicit) {
            console.warn(`[startup] Port ${port} is in use (PORT explicitly set). Auto-incrementing to ${nextPort} (attempt ${eaddrAttempts + 1}/${eaddrMax})...`);
          } else {
            console.warn(`[startup] Port ${port} is in use. Trying next port ${nextPort} (attempt ${eaddrAttempts + 1}/${eaddrMax})...`);
          }
          return resolve(startListening({ host, port: nextPort, maxRetries, tryCount: 0, eaddrAttempts: eaddrAttempts + 1, eaddrMax }));
        }

        // Retry a couple of times for transient errors
        if (tryCount < maxRetries && (!err || err.code !== 'EADDRINUSE')) {
          const delayMs = 250 * (tryCount + 1);
          console.warn(`[startup] Transient error on listen (attempt ${tryCount + 1}/${maxRetries}). Retrying in ${delayMs}ms...`, err?.code || err?.message || err);
          setTimeout(() => {
            resolve(startListening({ host, port, maxRetries, tryCount: tryCount + 1, eaddrAttempts }));
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
startListening({ host: HOST, port: initialPort, eaddrMax: 5 })
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