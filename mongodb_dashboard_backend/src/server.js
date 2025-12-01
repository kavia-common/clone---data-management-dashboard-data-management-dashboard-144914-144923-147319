'use strict';

/* Load environment variables early */
try { require('dotenv').config(); } catch {}

const http = require('http');
const app = require('./app');

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

// Attach early error logging to avoid silent exits
server.on('error', (err) => {
  const code = err && err.code ? err.code : 'UNKNOWN';
  const msg = err?.message || String(err);
  // eslint-disable-next-line no-console
  console.error(`[startup] Server error (${code}) while binding to ${HOST}:${PORT}: ${msg}`);

  // Provide targeted guidance for common network errors without crashing the process immediately
  if (code === 'EADDRINUSE') {
    console.error(`[startup] Port ${PORT} is already in use. Ensure only one backend process is running on this port.`);
  } else if (code === 'EADDRNOTAVAIL') {
    console.error(`[startup] Address ${HOST} is not available on this host. Falling back to 0.0.0.0`);
    try {
      // Attempt a one-time fallback bind to 0.0.0.0
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`Express API server recovered and is listening on http://0.0.0.0:${PORT} (${NODE_ENV})`);
      });
      return;
    } catch (fallbackErr) {
      console.error('[startup] Fallback listen failed:', fallbackErr?.message || fallbackErr);
    }
  } else if (code === 'ECONNRESET') {
    console.warn('[startup] ECONNRESET detected during startup. This can happen due to proxy misconfiguration. Verify that any frontend proxy points to http://localhost:3001 and the backend does not proxy to itself.');
  }

  // As a last resort, exit non-zero to let the supervisor restart
  process.exit(1);
});

// Extra safety: catch unhandled errors to avoid abrupt termination without logs
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Express API server listening on http://${HOST}:${PORT} (${NODE_ENV})`);
  console.log(`READY: http://${HOST}:${PORT}`);
});

module.exports = server;
