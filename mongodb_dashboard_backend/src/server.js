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
const net = require('net');

const PREFERRED_PORT = Number(process.env.PORT) || 3001;
// Normalize HOST to ensure container reachability. Some environments inject localhost/127.0.0.1 which
// binds only to loopback and is not reachable from other containers; prefer 0.0.0.0 instead.
const rawHost = process.env.HOST || '0.0.0.0';
const HOST = ['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1'].includes(String(rawHost).toLowerCase())
  ? '0.0.0.0'
  : rawHost;
const PORT_FALLBACK_START = Number(process.env.PORT_FALLBACK_START) || (PREFERRED_PORT + 1);
const PORT_FALLBACK_TRIES = Number(process.env.PORT_FALLBACK_TRIES) || 9;
>>>>>>> REPLACE   
````   
Explanation: Add standardized readiness markers and more explicit logs when server starts listening
````edit file="data-management-dashboard-144914-144923/mongodb_dashboard_backend/src/server.js"      
<<<<<<< SEARCH
  console.log(`[ready] Server listening on http://${HOST}:${port} (ENV=${env})`);
  // Standard readiness markers for automated detectors
  console.log(`READY: http://${HOST}:${port}`);
  console.log(`BACKEND_READY: url=http://${HOST}:${port}`);
  console.log(`Listening on http://${HOST}:${port}`);
  try {
    console.log(`[ready] Health endpoint: http://${HOST}:${port}/health`);
    console.log(`[ready] Docs endpoint:   http://${HOST}:${port}/api-docs`);
    console.log(`[startup] Health:  curl http://127.0.0.1:${port}/health`);
    console.log(`[startup] Swagger: open http://127.0.0.1:${port}/api-docs`);
  } catch {}
=======
  console.log(`[ready] Server listening on http://${HOST}:${port} (ENV=${env})`);
  // Standard readiness markers for automated detectors
  console.log(`READY: http://${HOST}:${port}`);
  console.log(`BACKEND_READY: url=http://${HOST}:${port}`);
  console.log(`Listening on http://${HOST}:${port}`);
  try {
    console.log(`[ready] Health endpoint: http://${HOST}:${port}/health`);
    console.log(`[ready] Docs endpoint:   http://${HOST}:${port}/api-docs`);
    console.log(`[startup] Health:  curl http://127.0.0.1:${port}/health`);
    console.log(`[startup] Swagger: open http://127.0.0.1:${port}/api-docs`);
  } catch {}

// Defensive normalization
const normalizePort = (p) => (Number.isFinite(p) && p > 0 ? p : 3001);

// Quick port availability check
function isPortFree(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.once('close', () => resolve(true)).close())
      .listen(port, host);
  });
}

// Try to find a free port starting from preferred first then fallbacks
async function resolvePort() {
  const preferred = normalizePort(PREFERRED_PORT);
  // eslint-disable-next-line no-console
  console.log(`[startup] Attempting to bind on ${HOST}:${preferred}`);
  if (await isPortFree(preferred, HOST)) {
    return preferred;
  }
  // eslint-disable-next-line no-console
  console.warn(`[startup] Port ${preferred} in use. Searching for a free port...`);
  const start = normalizePort(PORT_FALLBACK_START);
  for (let i = 0; i < PORT_FALLBACK_TRIES; i += 1) {
    const candidate = start + i;
    // Skip if equals preferred
    if (candidate === preferred) { continue; }
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(candidate, HOST)) {
      // eslint-disable-next-line no-console
      console.warn(`[startup] Using fallback port ${candidate}`);
      return candidate;
    }
  }
  // If none found, fallback to preferred and let it error (rare)
  return preferred;
}

function banner(port) {
  const env = process.env.NODE_ENV || 'development';
  try {
    const dbName =
      mongoose?.connection?.db?.databaseName ||
      process.env.MONGODB_DB ||
      '(not connected)';
    // eslint-disable-next-line no-console
    console.log('[startup] Express is starting with DB:', dbName);
  } catch {}
  // eslint-disable-next-line no-console
  console.log(`[ready] Server listening on http://${HOST}:${port} (ENV=${env})`);
  try {
    console.log(`[ready] Health endpoint: http://${HOST}:${port}/health`);
    console.log(`[ready] Docs endpoint:   http://${HOST}:${port}/api-docs`);
    console.log(`[startup] Health:  curl http://127.0.0.1:${port}/health`);
    console.log(`[startup] Swagger: open http://127.0.0.1:${port}/api-docs`);
  } catch {}
}

let server;

// Boot sequence with port resolution and graceful error handling
(async () => {
  const port = await resolvePort();
  // eslint-disable-next-line no-console
  console.log(
    `[startup] Initializing server on ${HOST}:${port} (NODE_ENV=${process.env.NODE_ENV || 'development'})`
  );
  server = app
    .listen(port, HOST, () => {
      // Apply timeout tunables once server exists
      try {
        const reqTimeout = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || process.env.EXPRESS_ROUTE_TIMEOUT_MS || 300000);
        const headersTimeout = Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 310000);
        const keepAliveTimeout = Number(process.env.SERVER_KEEPALIVE_TIMEOUT_MS || 120000);
        if (Number.isFinite(reqTimeout) && reqTimeout > 0) server.setTimeout(reqTimeout);
        if (Number.isFinite(headersTimeout) && headersTimeout > 0) server.headersTimeout = headersTimeout;
        if (Number.isFinite(keepAliveTimeout) && keepAliveTimeout > 0) server.keepAliveTimeout = keepAliveTimeout;
      } catch (e) {
        console.warn('[startup] Failed to apply server timeout tunables:', e?.message || e);
      }
      banner(port);
    })
    .on('error', async (err) => {
      if (err && err.code === 'EADDRINUSE') {
        // Last-chance fallback: try next port if initial binding collides due to race
        const nextPort = port + 1;
        // eslint-disable-next-line no-console
        console.warn(`[startup] Port ${port} became busy. Retrying on ${nextPort}...`);
        try {
          server = app.listen(nextPort, HOST, () => banner(nextPort));
          return;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[startup] Retry failed:', e);
        }
      } else {
        // eslint-disable-next-line no-console
        console.error('[startup] Server failed to start:', err);
      }
      // Exit only if we truly cannot bind any port
      process.exit(1);
    });
})();

// Graceful shutdown
const shutdown = (signal) => {
  // eslint-disable-next-line no-console
  console.log(`${signal} signal received: closing HTTP server`);
  if (!server) {
    process.exit(0);
    return;
  }
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