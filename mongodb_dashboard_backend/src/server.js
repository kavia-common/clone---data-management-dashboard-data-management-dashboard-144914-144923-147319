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

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// PUBLIC_INTERFACE
function logListening(host, port) {
  /** Logs a consistent listening line used by some preview systems. */
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
 * Check if a given PID is a live process.
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to determine if something is actually bound on PORT.
 * We consider it bound if a TCP connect does not immediately fail; timeout also implies something captured the port.
 * Returns a promise<boolean>.
 */
function isPortBound(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { client.destroy(); } catch {}
      resolve(result);
    };
    client.setTimeout(timeoutMs);
    client.once('connect', () => finish(true));
    client.once('timeout', () => finish(true));
    client.once('error', () => finish(true));
    try {
      client.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

/**
 * PUBLIC_INTERFACE
 * ensurePidFileGuard
 * Ensures single-instance behavior using a PID file.
 * - If PID file exists and process is alive, and port appears bound, logs and exits.
 * - If PID file exists but process is not alive or port is not bound, remove it and continue.
 */
async function ensurePidFileGuard() {
  if (!fs.existsSync(PID_FILE)) return;
  try {
    const pidStr = fs.readFileSync(PID_FILE, 'utf8').trim();
    const existingPid = Number(pidStr);
    if (!Number.isFinite(existingPid) || existingPid <= 0) {
      fs.unlinkSync(PID_FILE);
      return;
    }
    const alive = isProcessAlive(existingPid);
    const bound = await isPortBound(PORT);
    if (alive && bound) {
      // eslint-disable-next-line no-console
      console.log(`[startup] Another instance is active (pid=${existingPid}) on port ${PORT}. Exiting.`);
      process.exit(0);
    } else {
      // stale PID or not bound => cleanup
      try {
        fs.unlinkSync(PID_FILE);
        // eslint-disable-next-line no-console
        console.log(`[startup] Removed stale PID file at ${PID_FILE}`);
      } catch {}
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

/**
 * Try to start server; if EADDRINUSE, check PID file and port liveliness;
 * if stale, remove PID and retry ONCE.
 */
async function bindServerWithPidRetry() {
  await ensurePidFileGuard();

  let attemptedRetry = false;

  const attemptListen = () => {
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
      .on('error', async (err) => {
        if (err && err.code === 'EADDRINUSE') {
          // eslint-disable-next-line no-console
          console.error(`[startup] EADDRINUSE port ${PORT}. A process may already be bound. Checking PID file ${PID_FILE} ...`);
          let cleaned = false;
          try {
            if (fs.existsSync(PID_FILE)) {
              const pidStr = fs.readFileSync(PID_FILE, 'utf8').trim();
              const existingPid = Number(pidStr);
              const alive = Number.isFinite(existingPid) && existingPid > 0 ? isProcessAlive(existingPid) : false;
              const bound = await isPortBound(PORT);
              if (!alive || !bound) {
                try {
                  fs.unlinkSync(PID_FILE);
                  cleaned = true;
                  console.log(`[startup] Removed stale PID file at ${PID_FILE}; will retry bind once.`);
                } catch {}
              }
            } else {
              // No PID file but still EADDRINUSE; check bound
              const bound = await isPortBound(PORT);
              if (!bound) {
                cleaned = true; // likely a race; allow retry
                console.log('[startup] Port reported in-use but appears unbound; retrying once.');
              }
            }
          } catch {}

          if (!attemptedRetry && cleaned) {
            attemptedRetry = true;
            setTimeout(() => {
              attemptListen();
            }, 150);
            return;
          }
        } else {
          // eslint-disable-next-line no-console
          console.error('[startup] Server failed to start:', err?.message || err);
        }
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
  };

  return attemptListen();
}

// Export started server
module.exports = bindServerWithPidRetry();