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

/**
 * Resolve port and host with safe defaults.
 * - Prefer binding to 0.0.0.0 unless an explicit and valid non-localhost HOST is provided.
 * - Normalize common loopback/IPv6 variants to 0.0.0.0 for preview/dev environments to avoid EADDRNOTAVAIL.
 */
const PORT = Number(process.env.PORT || 3001);
const HOST_ENV = (process.env.HOST || '').trim();
const NODE_ENV = process.env.NODE_ENV || 'development';

function normalizeHostForDev(host) {
  const h = (host || '').trim().toLowerCase();
  if (!h) return '0.0.0.0';
  const loopbacks = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);
  if (loopbacks.has(h)) return '0.0.0.0';
  // In some preview environments, IPv6 unspecified may be presented
  if (h === '::' || h === '[::]') return '0.0.0.0';
  // Avoid obviously invalid or placeholder values
  if (/^\s*$/.test(h) || /undefined|null/i.test(h)) return '0.0.0.0';
  return host;
}

const HOST = normalizeHostForDev(HOST_ENV);

/* Minimal diagnostics to detect misconfiguration */
// eslint-disable-next-line no-console
console.log(`[startup] NODE_ENV=${NODE_ENV} HOST=${HOST} PORT=${PORT} PID=${process.pid}`);
try {
  // Disable source maps in dev to avoid memory bloat in some environments
  if (!process.env.NODE_ENV_DISABLE_SOURCE_MAPS) process.env.NODE_ENV_DISABLE_SOURCE_MAPS = '1';
  // Cap Node heap in case scripts don't enforce it externally
  if (!process.env.NODE_OPTIONS?.includes('--max-old-space-size')) {
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --max-old-space-size=2048`.trim();
    console.log(`[startup] Applied NODE_OPTIONS=${process.env.NODE_OPTIONS}`);
  }
} catch {}
if (process.env.NODE_OPTIONS) {
  // eslint-disable-next-line no-console
  console.log(`[startup] NODE_OPTIONS=${process.env.NODE_OPTIONS}`);
}
// Warn if suspicious proxy-related env vars are set which could indicate a self-proxy loop in dev tools
try {
  const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'PROXY'];
  const foundProxyVars = proxyVars.filter((k) => process.env[k]);
  if (foundProxyVars.length) {
    console.warn(`[startup] Detected proxy environment variables (${foundProxyVars.join(', ')}). Ensure your frontend dev proxy targets http://localhost:${PORT} and backend does NOT proxy to itself.`);
  }
} catch {}

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
    // Not recoverable without freeing the port; avoid crashing here to allow operator to free the port.
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
    // Do not set exit code; keep process alive for orchestrator hot-reload.
    return;
  }

  if (code === 'ECONNRESET') {
    console.warn(
      `[startup] ECONNRESET detected during startup. This can happen if a client/proxy disconnects early. Backend will continue running on http://${HOST}:${PORT}.`
    );
    return; // Non-fatal; ignore
  }

  // Unknown error: log but do not crash; allow orchestrator to decide on restarts
  return;
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
  // Attach a one-time runtime error handler after listen in case of late errors
  server.on('clientError', (err, socket) => {
    try {
      console.warn('[server] clientError:', err?.message || err);
      if (socket && !socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    } catch {}
  });
}

// Start server
safeListen(HOST);

module.exports = server;
