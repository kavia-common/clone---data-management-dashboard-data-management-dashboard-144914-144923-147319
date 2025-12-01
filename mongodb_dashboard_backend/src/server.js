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

let PORT = Number(process.env.PORT || process.env.REACT_APP_PORT) || 3001;
// Always bind 0.0.0.0 to avoid EADDRNOTAVAIL in container/preview envs when frontend proxy targets localhost
const HOST = (process.env.HOST && process.env.HOST !== 'localhost') ? process.env.HOST : '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// To prevent duplicate dev servers and hard crashes, allow a single retry on EADDRINUSE to the next port.
// Frontend is expected on 3000; backend prefers 3001. We will try 3001 then 3002.
const PREFERRED_PORT = 3001;
const FALLBACK_PORT = 3002;

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
  let attemptedFallback = false;

  const bind = () => {
    const server = app
      .listen(PORT, HOST, () => {
        try {
          const dbName =
            mongoose?.connection?.db?.databaseName ||
            process.env.MONGODB_DB ||
            '(not connected)';
          console.log(`[startup] listening http://${HOST}:${PORT} | db=${dbName}`);
          logListening(HOST, PORT);
          console.log(`[startup] /health | /ready | /api/health | /api/docs | /api-docs`);
          console.log(`READY: http://${HOST}:${PORT}`);
          console.log(`BACKEND_READY: url=http://${HOST}:${PORT}`);
          console.log(`Listening on http://${HOST}:${PORT}`);
        } catch {}
        writePidFile();
      })
      .on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
          console.error(`[startup] EADDRINUSE port ${PORT}. A process is already bound. See ${PID_FILE}.`);
          // If currently using preferred port and we haven't tried fallback, retry once on 3002
          if (!attemptedFallback && PORT === PREFERRED_PORT) {
            attemptedFallback = true;
            PORT = FALLBACK_PORT;
            // Update PID file path to reflect new port
            try { fs.mkdirSync(path.dirname(PID_FILE), { recursive: true }); } catch {}
            console.warn(`[startup] Retrying on fallback port ${PORT}...`);
            return setTimeout(bind, 150); // short debounce to avoid tight loop
          }
        } else {
          console.error('[startup] Server failed to start:', err?.message || err);
        }
        process.exit(1);
      });

    const shutdown = (signal) => {
      try {
        console.log(`${signal} received; shutting down`);
        server.close(async () => {
          try {
            await mongoose.connection.close();
          } catch (e) {
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
      console.error('[unhandledRejection]', reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('[uncaughtException]', err);
    });

    return server;
  };

  return bind();
}

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