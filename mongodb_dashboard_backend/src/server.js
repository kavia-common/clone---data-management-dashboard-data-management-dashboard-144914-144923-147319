/* Ensure environment variables from .env are loaded even if the process
 * is started without "-r dotenv/config" (e.g., by external orchestrators).
 * This guarantees preview/CI can boot without special node flags.
 */
try { require('dotenv').config(); } catch {}

const fs = require('fs');
const path = require('path');
const app = require('./app');
const mongoose = require('mongoose');

// Default to 3001 to match container deployment and docs URL
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Optional dev behavior tuning
const DEV_PORT_RETRY_MS = Number(process.env.DEV_PORT_RETRY_MS || 1500);
const DEV_PORT_MAX_RETRIES = Number(process.env.DEV_PORT_MAX_RETRIES || 10);
// Use a pidfile inside tmp to detect stale same-app instances
const PID_FILE = path.join(process.cwd(), '.tmp', `server.${PORT}.pid`);

// Ensure .tmp exists for pid management
try {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
} catch {}

// Early startup banner to aid diagnostics
try {
  // eslint-disable-next-line no-console
  console.log(`[startup] Initializing server on ${HOST}:${PORT} (NODE_ENV=${NODE_ENV})`);
} catch {}

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
 * Attempt to determine if the currently bound process on the port is our own "stale watcher".
 * We cannot inspect sockets without elevated permissions, so we heuristically:
 * - Check if a pid file exists from a prior run that is no longer alive
 * - If it exists and process is not running, we remove it and allow retry.
 * - If it exists and process is alive, we do not force takeover; we will print guidance.
 */
function detectAndCleanupStaleWatcher() {
  try {
    if (!fs.existsSync(PID_FILE)) return false;
    const pidStr = fs.readFileSync(PID_FILE, 'utf8').trim();
    const stalePid = Number(pidStr);
    if (!Number.isFinite(stalePid)) {
      fs.unlinkSync(PID_FILE);
      return false;
    }
    try {
      // signal 0 checks existence without killing
      process.kill(stalePid, 0);
      // PID alive -> not stale
      return false;
    } catch {
      // PID not alive -> stale, cleanup pid file and return true
      fs.unlinkSync(PID_FILE);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Start HTTP server with dev-only retry loop if EADDRINUSE is encountered.
 * In production we keep strict behavior and exit immediately.
 */
function startServerWithDevFallback(attempt = 0) {
  const server = app
    .listen(PORT, HOST, () => {
      try {
        // Guard: mongoose.connection.db may be undefined before initial connection
        const dbName =
          mongoose?.connection?.db?.databaseName ||
          process.env.MONGODB_DB ||
          '(not connected)';
        // eslint-disable-next-line no-console
        console.log('[startup] Express is starting with DB:', dbName);
      } catch {
        // ignore logging failure
      }
      // eslint-disable-next-line no-console
      console.log(
        `[startup] Express listening on http://${HOST}:${PORT} (NODE_ENV=${NODE_ENV})`
      );
      try {
        // Helpful hint: echo how to curl health
        console.log(`[startup] Health: curl http://127.0.0.1:${PORT}/api/health`);
        console.log(`[startup] Swagger UI: http://127.0.0.1:${PORT}/api/docs`);
      } catch {}
      writePidFile();
    })
    .on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        if (NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.warn(
            `[startup] Port ${PORT} is already in use (attempt ${attempt + 1}).`
          );
          const cleaned = detectAndCleanupStaleWatcher();
          if (cleaned) {
            // eslint-disable-next-line no-console
            console.warn('[startup] Detected stale PID file; cleaned up. Retrying shortly...');
          }

          if (attempt + 1 < DEV_PORT_MAX_RETRIES) {
            setTimeout(() => startServerWithDevFallback(attempt + 1), DEV_PORT_RETRY_MS);
            return;
          }

          // Final attempt failed — provide clear guidance but do not change binding.
          // eslint-disable-next-line no-console
          console.error(
            `[startup] Could not bind to port ${PORT} after ${DEV_PORT_MAX_RETRIES} retries.\n` +
            `Another process is likely running.\n` +
            `Tips:\n` +
            ` - If using nodemon or a watcher, stop the previous instance.\n` +
            ` - Or export PORT=<free-port> to override for local testing.\n` +
            ` - Check PID file at: ${PID_FILE}\n`
          );
        } else {
          // eslint-disable-next-line no-console
          console.error(
            `[startup] Port ${PORT} is already in use. Ensure no other process is running on this port.`
          );
        }
      } else {
        // eslint-disable-next-line no-console
        console.error('[startup] Server failed to start:', err);
      }
      // Exit so orchestrator/CI can restart or developer can intervene
      process.exit(1);
    });

  // Graceful shutdown handlers
  const shutdown = (signal) => {
    // eslint-disable-next-line no-console
    console.log(`${signal} signal received: closing HTTP server`);
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
      } finally {
        removePidFile();
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

  return server;
}

// Production: strict; Development: retry/wait if stale watcher detected
module.exports = startServerWithDevFallback();