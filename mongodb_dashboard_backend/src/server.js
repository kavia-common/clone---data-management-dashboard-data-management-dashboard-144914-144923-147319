/* Ensure environment variables from .env are loaded even if the process
 * is started without "-r dotenv/config" (e.g., by external orchestrators).
 * This guarantees preview/CI can boot without special node flags.
 */
try { require('dotenv').config(); } catch {}

const fs = require('fs');
const path = require('path');
const net = require('net');
const app = require('./app');
const mongoose = require('mongoose');

const PORT = Number(process.env.PORT || process.env.REACT_APP_PORT) || 3001;
/**
 * Determine host binding:
 * - If HOST explicitly provided and not 'localhost', use it.
 * - Otherwise prefer 0.0.0.0 to avoid EADDRNOTAVAIL inside containers or preview where ::1/localhost may be unavailable.
 * - Never bind to 'localhost' explicitly (can resolve to ::1 in some envs).
 */
let HOST = '0.0.0.0';
if (process.env.HOST && process.env.HOST !== 'localhost') {
  HOST = process.env.HOST;
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

/* Concise startup banner and proxy loop guard hints */
try {
  console.log(`[startup] ${NODE_ENV} | ${HOST}:${PORT}`);
  const proxyTargets = [
    process.env.REACT_APP_API_BASE_URL,
    process.env.REACT_APP_API_URL,
    process.env.PROXY_TARGET,
  ].filter(Boolean);
  if (proxyTargets.length) {
    console.log('[startup] proxy targets:', proxyTargets.join(', '));
  }
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
      try {
        const envDump = JSON.stringify({
          host: HOST,
          port: PORT,
          nodeEnv: NODE_ENV,
          reactAppPort: process.env.REACT_APP_PORT || null,
          reactAppApiUrl: process.env.REACT_APP_API_BASE_URL || process.env.REACT_APP_API_URL || null,
          proxyHost: process.env.REACT_APP_PROXY_HOST || null,
        });
        console.error('[startup] listen() error env:', envDump);
      } catch {}
      if (err && err.code === 'EADDRINUSE') {
        console.error(`[startup] EADDRINUSE: Port ${PORT} already in use. Another process is bound. PID file: ${PID_FILE}.`);
      } else if (err && err.code === 'EADDRNOTAVAIL') {
        console.error(`[startup] EADDRNOTAVAIL: Address ${HOST} is not available in this environment.`);
        console.error('[startup] Hint: Avoid binding to localhost/::1 in containers. Try HOST=0.0.0.0 or unset HOST.');
      } else {
        console.error('[startup] Server failed to start:', err?.message || err);
      }
      // Extra note if proxy could be looping
      console.error('[startup] If using a dev proxy, ensure it targets 127.0.0.1:3001 (not the same origin:port to avoid self-proxy loops).');
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
  });
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[uncaughtException]', err);
  });

  return server;
}

// Export started server
module.exports = startServerStrict();