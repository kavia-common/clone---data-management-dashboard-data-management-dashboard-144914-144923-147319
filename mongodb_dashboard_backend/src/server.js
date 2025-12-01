'use strict';

/* Load environment variables early */
try { require('dotenv').config(); } catch {}

const http = require('http');
let app;
try {
  app = require('./app');
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[startup] Failed to load app module:', e?.message || e);
  app = (req, res) => res.status(503).json({ success: false, message: 'Service initializing' });
}

// Resolve port and host with safe defaults
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

/**
 * Backend runtime note:
 * - Pure Express server only; no CRA/Vite/webpack dev server is started here.
 * - NODE_OPTIONS can cap memory via --max_old_space_size=256 and disable source maps for speed.
 */
const server = http.createServer(app);

// Internal state flags to avoid duplicate listen calls during recovery
let hasStartedListening = false;
let attemptedFallback = false;

// Simple keepalive: periodic no-op to keep event loop active in low-traffic previews
const KEEPALIVE_INTERVAL_MS = Number(process.env.KEEPALIVE_INTERVAL_MS || 30000);
let keepaliveTimer = null;
function startKeepalive() {
  try {
    if (keepaliveTimer) return;
    keepaliveTimer = setInterval(() => {
      try {
        // No-op. If needed, we could ping a simple function or log infrequently.
      } catch {}
    }, KEEPALIVE_INTERVAL_MS);
    // In Node >= 11, unref to allow clean exit when needed
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
  try {
    clearInterval(keepaliveTimer);
  } catch {}
  try {
    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('[process] HTTP server closed. Exiting.');
      process.exit(0);
    });
    // Failsafe exit if close takes too long
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
  console.error(`[startup] Server error (${code}) while binding to ${HOST}:${PORT}: ${msg}`);

  // Provide targeted guidance for common network errors without crashing the process immediately
  if (code === 'EADDRINUSE') {
    console.error(`[startup] Port ${PORT} is already in use. Ensure only one backend process is running on this port.`);
    // This is not recoverable without freeing the port; let orchestrator restart
    process.exitCode = 1;
    return;
  }

  if (code === 'EADDRNOTAVAIL') {
    console.error(`[startup] Address ${HOST} is not available on this host. Attempting fallback to 0.0.0.0...`);
    // Attempt a one-time fallback bind to 0.0.0.0 if we haven't already tried
    if (!attemptedFallback && !hasStartedListening) {
      attemptedFallback = true;
      try {
        server.listen(PORT, '0.0.0.0', () => {
          hasStartedListening = true;
          console.log(`Express API server recovered and is listening on http://0.0.0.0:${PORT} (${NODE_ENV})`);
        });
        return; // do not exit while attempting recovery
      } catch (fallbackErr) {
        console.error('[startup] Fallback listen failed:', fallbackErr?.message || fallbackErr);
      }
    } else {
      console.warn('[startup] Fallback already attempted or server already started; ignoring.');
    }
    // Do not crash; allow orchestrator/health checks to retry
    process.exitCode = 1;
    return;
  }

  if (code === 'ECONNRESET') {
    console.warn('[startup] ECONNRESET detected during startup. This can happen due to proxy misconfiguration or clients disconnecting early. Backend will continue running. Verify frontend dev proxy points to http://localhost:3001 and backend does not proxy to itself.');
    // Non-fatal; do not exit
    return;
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

server.listen(PORT, HOST, () => {
  hasStartedListening = true;
  // eslint-disable-next-line no-console
  console.log(`Express API server listening on http://${HOST}:${PORT} (${NODE_ENV})`);
  console.log(`READY: http://${HOST}:${PORT}`);
  // Make sure keepalive is running after bind
  startKeepalive();
});

module.exports = server;
