'use strict';

/* Load environment variables early */
try { require('dotenv').config(); } catch {}

/**
 * This server process is a plain HTTP server for the API only.
 * It does not start any dev bundlers or implement any proxying.
 * Frontend should proxy /api to this backend (e.g., http://localhost:3001).
 */
const http = require('http');

let app;
try {
  app = require('./app');
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[startup] Failed to load app module:', e?.message || e);
  app = (req, res) => res.status(503).json({ success: false, message: 'Service initializing' });
}

// Resolve port and host with safe defaults.
// Prefer binding to 0.0.0.0 unless a non-localhost HOST is provided to avoid EADDRNOTAVAIL.
const PORT = Number(process.env.PORT || 3001);
const HOST_ENV = process.env.HOST;
const HOST = (HOST_ENV && HOST_ENV !== 'localhost') ? HOST_ENV : '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Minimal diagnostics to detect misconfiguration
// eslint-disable-next-line no-console
console.log(`[startup] NODE_ENV=${NODE_ENV} HOST=${HOST} PORT=${PORT} PID=${process.pid}`);
if (process.env.NODE_OPTIONS) {
  // eslint-disable-next-line no-console
  console.log(`[startup] NODE_OPTIONS=${process.env.NODE_OPTIONS}`);
}

const server = http.createServer(app);

// Internal state flags to avoid duplicate listen calls during recovery
let hasStartedListening = false;
let attemptedFallback = false;
let listenInProgress = false;

// Simple keepalive: periodic no-op to keep event loop active in low-traffic previews
const KEEPALIVE_INTERVAL_MS = Number(process.env.KEEPALIVE_INTERVAL_MS || 30000);
let keepaliveTimer = null;
function startKeepalive() {
  try {
    if (keepaliveTimer) return;
    keepaliveTimer = setInterval(() => {
      try {
        // intentional no-op
      } catch {}
    }, KEEPALIVE_INTERVAL_MS);
    if (keepaliveTimer && typeof keepaliveTimer.unref === 'function') {
      keepaliveTimer.unref();
    }
  } catch {}
}
startKeepalive();

// Graceful shutdown handlers
function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[process] Received ${signal}. Closing server gracefully...`);
  try { clearInterval(keepaliveTimer); } catch {}
  try {
    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('[process] HTTP server closed. Exiting.');
      process.exit(0);
    });
    setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn('[process] Force exiting after timeout.');
      process.exit(0);
    }, 5000).unref?.();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[process] Error during shutdown:', e?.message || e);
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Attach early error logging to avoid silent exits
server.on('error', (err) => {
  const code = err && err.code ? err.code : 'UNKNOWN';
  const msg = err?.message || String(err);
  // eslint-disable-next-line no-console
  console.error(
    `[startup] Server error (${code}) while binding to ${HOST}:${PORT}: ${msg}`
  );

  if (code === 'EADDRINUSE') {
    console.error(
      `[startup] Port ${PORT} is already in use. Ensure only one backend process is running on this port.`
    );
    // Not recoverable without freeing the port; let orchestrator/runner handle restart
    process.exitCode = 1;
    return;
  }

  if (code === 'EADDRNOTAVAIL') {
    console.error(
      `[startup] Address ${HOST} is not available on this host. Attempting fallback to 0.0.0.0...`
    );
    if (!attemptedFallback && !hasStartedListening && !listenInProgress) {
      attemptedFallback = true;
      try {
        listenInProgress = true;
        server.listen(PORT, '0.0.0.0', () => {
          hasStartedListening = true;
          listenInProgress = false;
          console.log(
            `Express API server recovered and is listening on http://0.0.0.0:${PORT} (${NODE_ENV})`
          );
        });
        return; // do not exit while attempting recovery
      } catch (fallbackErr) {
        listenInProgress = false;
        console.error('[startup] Fallback listen failed:', fallbackErr?.message || fallbackErr);
      }
    } else {
      console.warn('[startup] Fallback already attempted or server already started; ignoring.');
    }
    // Set exit code for orchestrator, but don't hard-exit immediately to allow logs to flush
    process.exitCode = 1;
    return;
  }

  if (code === 'ECONNRESET') {
    console.warn(
      '[startup] ECONNRESET detected during startup. This can happen if a client/proxy disconnects early. Backend will continue running. Ensure frontend dev proxy targets http://localhost:3001 and backend does not proxy to itself.'
    );
    return; // Non-fatal; ignore
  }

  // Unknown fatal during bind: set exit code but do not hard exit immediately to allow logs to flush
  process.exitCode = 1;
});

// Extra safety: catch unhandled errors to avoid abrupt termination without logs
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason);
});

// Guard against duplicate listen attempts
function safeListen(host) {
  if (hasStartedListening || listenInProgress) {
    return;
  }
  listenInProgress = true;
  server.listen(PORT, host, () => {
    hasStartedListening = true;
    listenInProgress = false;
    // eslint-disable-next-line no-console
    console.log(`Express API server listening on http://${host}:${PORT} (${NODE_ENV})`);
    console.log(`READY: http://${host}:${PORT}`);
    startKeepalive();
  });
}

// Start server
safeListen(HOST);

module.exports = server;
