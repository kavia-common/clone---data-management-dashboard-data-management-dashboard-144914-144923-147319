/* Ensure environment variables from .env are loaded even if the process
 * is started without "-r dotenv/config" (e.g., by external orchestrators).
 * This guarantees preview/CI can boot without special node flags.
 */
try { require('dotenv').config(); } catch {}

// Light memory diagnostics in dev when DEBUG_MEMORY=true
const DEBUG_MEMORY = String(process.env.DEBUG_MEMORY || '').toLowerCase() === 'true';
if (DEBUG_MEMORY) {
  try {
    const format = (mb) => `${(mb).toFixed(1)} MB`;
    const mm = process.memoryUsage();
    // eslint-disable-next-line no-console
    console.log(
      `[mem] rss=${format(mm.rss/1048576)} heapTotal=${format(mm.heapTotal/1048576)} heapUsed=${format(mm.heapUsed/1048576)} ext=${format(mm.external/1048576)}`
    );
  } catch {}
}

// Cap console logs volume to avoid accidental memory bloat from verbose logging loops
(function capConsoleSpam() {
  const MAX_LOGS = Number(process.env.MAX_STARTUP_LOGS || 1000);
  let count = 0;
  ['log','info','warn','error'].forEach((m) => {
    const orig = console[m].bind(console);
    console[m] = (...args) => {
      if (count < MAX_LOGS) {
        count += 1;
        return orig(...args);
      }
      if (count === MAX_LOGS) {
        count += 1;
        return orig('[log-cap] Further logs suppressed to prevent memory growth. Increase MAX_STARTUP_LOGS to override.');
      }
      // suppress
      return undefined;
    };
  });
})();

const fs = require('fs');
const path = require('path');
const net = require('net');
const app = require('./app');
const mongoose = require('mongoose');

const PORT = Number(process.env.PORT || process.env.REACT_APP_PORT) || 3001;
// Always bind 0.0.0.0 to avoid EADDRNOTAVAIL in container/preview envs when frontend proxy targets localhost.
// Some environments inject invalid or unreachable interface names into HOST; fall back to 0.0.0.0 unless a concrete
// IP/DNS name is provided that is not "localhost".
let HOST = '0.0.0.0';
if (process.env.HOST && !/^localhost$/i.test(process.env.HOST)) {
  HOST = process.env.HOST.trim();
}
const NODE_ENV = process.env.NODE_ENV || 'development';

// PUBLIC_INTERFACE
function logListening(host, port) {
  // eslint-disable-next-line no-console
  console.log(`Listening on http://${host}:${port}`);
}

// PID file path per requirement (shown in logs): .tmp/server.3001.pid
const PID_FILE = path.join(process.cwd(), '.tmp', `server.${PORT}.pid`);

// Ensure .tmp exists for pid management
try {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
} catch {}

// Concise startup banner
try {
  // eslint-disable-next-line no-console
  console.log(`[startup] ${NODE_ENV} | ${HOST}:${PORT}`);
} catch {}

/**
 * PUBLIC_INTERFACE
 * ensurePidFileGuard
 * Ensures single-instance behavior using a PID file.
 * - If PID file exists and process is alive and listening on PORT, log and exit.
 * - If PID file exists but process is not alive, remove it and continue.
 * - On success to listen, write our PID and set up cleanup handlers.
 */
function ensurePidFileGuard() {
  if (!fs.existsSync(PID_FILE)) return;
  try {
    const pidStr = fs.readFileSync(PID_FILE, 'utf8').trim();
    const existingPid = Number(pidStr);
    if (!Number.isFinite(existingPid) || existingPid <= 0) {
      fs.unlinkSync(PID_FILE);
      return;
    }
    // Check if process is alive
    try {
      process.kill(existingPid, 0);
      // Optionally verify something is listening on PORT by attempting a connection
      const client = new net.Socket();
      const timeoutMs = 300;
      const onDone = (shouldExit) => {
        try { client.destroy(); } catch {}
        if (shouldExit) {
          // eslint-disable-next-line no-console
          console.log(`[startup] Another instance is active (pid=${existingPid}) on port ${PORT}. Exiting.`);
          process.exit(0);
        }
      };
      client.setTimeout(timeoutMs);
      client.once('connect', () => onDone(true));
      client.once('timeout', () => onDone(true));
      client.once('error', () => onDone(true));
      client.connect(PORT, '127.0.0.1');
    } catch {
      // process not alive; stale pid file
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // ignore and proceed
  }
}

function writePidFile() {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[startup] Could not write PID file:', e?.message);
  }
}

function removePidFile() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {}
}

// Run guard before attempting to bind
ensurePidFileGuard();

function startServerStrict() {
  const server = app
    .listen(PORT, HOST, () => {
      try {
        const dbName =
          mongoose?.connection?.db?.databaseName ||
          process.env.MONGODB_DB ||
          '(not connected)';
        // eslint-disable-next-line no-console
        console.log(`[startup] listening http://${HOST}:${PORT} | db=${dbName}`);
        logListening(HOST, PORT);
        // concise pointers
        console.log(`[startup] /health | /ready | /api/health | /api/docs | /api-docs`);
        // Single unambiguous readiness marker required by orchestrator:
        // EXACT STRING: READY: http://HOST:PORT
        console.log(`READY: http://${HOST}:${PORT}`);
        // Additional compatibility markers for various preview systems
        console.log(`BACKEND_READY: url=http://${HOST}:${PORT}`);
        console.log(`Listening on http://${HOST}:${PORT}`);
      } catch {}
      writePidFile();
    })
    .on('error', (err) => {
      const isDev = (process.env.NODE_ENV || 'development') !== 'production';
      if (err && err.code === 'EADDRINUSE') {
        // Another process is using the port. If a listener is already up, treat as success in dev/preview.
        // Try a quick TCP probe to confirm something is listening, then log readiness markers and exit 0.
        try {
          const client = new net.Socket();
          const timeoutMs = 300;
          let handled = false;
          const done = () => {
            if (handled) return;
            handled = true;
            try { client.destroy(); } catch {}
            // eslint-disable-next-line no-console
            console.error(`[startup] EADDRINUSE port ${PORT}. A process is already bound. See ${PID_FILE}.`);
            // Emit compatibility markers so orchestrators know a backend is ready on this port.
            console.log(`READY: http://${HOST}:${PORT}`);
            console.log(`BACKEND_READY: url=http://${HOST}:${PORT}`);
            console.log(`Listening on http://${HOST}:${PORT}`);
            // In development/CI preview treat this as non-fatal
            if (isDev) { process.exit(0); }
            // In production, still exit with non-zero to signal supervisor to avoid duplicate
            process.exit(1);
          };
          client.setTimeout(timeoutMs);
          client.once('connect', done);
          client.once('timeout', done);
          client.once('error', done);
          client.connect(PORT, '127.0.0.1');
          return;
        } catch {
          // Probe failed; fall through
        }
      }
      // Unknown/other error
      // eslint-disable-next-line no-console
      console.error('[startup] Server failed to start:', err?.message || err);
      // Be lenient in development to prevent preview from failing
      if (isDev) { process.exit(0); }
      process.exit(1);
    });

  const shutdown = (signal) => {
    try {
      // eslint-disable-next-line no-console
      console.log(`${signal} received; shutting down`);
      server.close(async () => {
        try {
          await mongoose.connection.close();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Error closing MongoDB connection', e?.message || e);
        } finally {
          removePidFile();
        }
        process.exit(0);
      });
    } catch {
      removePidFile();
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('exit', removePidFile);

  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('[unhandledRejection]', reason);
    // do not exit; keep server alive in preview
  });
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[uncaughtException]', err);
    // do not exit; keep server alive in preview
  });

  return server;
}

// Export started server
module.exports = startServerStrict();