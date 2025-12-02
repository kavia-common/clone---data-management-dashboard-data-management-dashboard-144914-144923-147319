try { require('dotenv').config(); } catch {}

const fs = require('fs');
const path = require('path');
const net = require('net');
const app = require('./app');
const mongoose = require('mongoose');

const PORT = Number(process.env.PORT || process.env.REACT_APP_PORT) || 3001;
const HOST = (process.env.HOST && process.env.HOST !== 'localhost') ? process.env.HOST : '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const NODE_OPTIONS = process.env.NODE_OPTIONS || '';
const GENERATE_SOURCEMAP = process.env.GENERATE_SOURCEMAP;

// PUBLIC_INTERFACE
function logListening(host, port) {
  console.log(`Listening on http://${host}:${port}`);
}

// PID file path for single-instance guard
const PID_FILE = path.join(process.cwd(), '.tmp', `server.${PORT}.pid`);
try { fs.mkdirSync(path.dirname(PID_FILE), { recursive: true }); } catch {}

console.log(`[startup] ${NODE_ENV} | ${HOST}:${PORT} | node=${process.version}`);
if (NODE_OPTIONS) console.log(`[startup] NODE_OPTIONS=${NODE_OPTIONS}`);
if (GENERATE_SOURCEMAP === 'false') console.log('[startup] Source maps disabled');

function ensurePidFileGuard() {
  if (!fs.existsSync(PID_FILE)) return;
  try {
    const pidStr = fs.readFileSync(PID_FILE, 'utf8').trim();
    const existingPid = Number(pidStr);
    if (!Number.isFinite(existingPid) || existingPid <= 0) {
      fs.unlinkSync(PID_FILE);
      return;
    }
    try {
      process.kill(existingPid, 0);
      const client = new net.Socket();
      const timeoutMs = 300;
      const onDone = (shouldExit) => {
        try { client.destroy(); } catch {}
        if (shouldExit) {
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
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // ignore and continue
  }
}

function writePidFile() {
  try { fs.writeFileSync(PID_FILE, String(process.pid), 'utf8'); } catch (e) {
    console.warn('[startup] Could not write PID file:', e?.message);
  }
}
function removePidFile() {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch {}
}

ensurePidFileGuard();

function startServerStrict() {
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
      } catch {}
      writePidFile();
    })
    .on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error(`[startup] EADDRINUSE port ${PORT}. A process is already bound. See ${PID_FILE}.`);
      } else {
        console.error('[startup] Server failed to start:', err?.message || err);
      }
      process.exit(1);
    });

  const shutdown = (signal) => {
    try {
      console.log(`${signal} received; shutting down`);
      server.close(async () => {
        try { await mongoose.connection.close(); } catch (e) {
          console.error('Error closing MongoDB connection', e?.message || e);
        } finally {
          removePidFile();
        }
        process.exit(0);
      });
      setTimeout(() => {
        console.warn('[shutdown] force exiting');
        removePidFile();
        process.exit(1);
      }, 5000).unref();
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
    const code = err && err.code;
    if (code === 'EADDRNOTAVAIL' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
      console.warn(`[uncaughtException] Ignored transient network error: ${code} - ${err.message}`);
      return;
    }
    console.error('[uncaughtException]', err);
  });
  process.on('error', (err) => {
    const code = err && err.code;
    if (code === 'EADDRNOTAVAIL' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
      console.warn(`[process error] Ignored transient network error: ${code} - ${err.message}`);
      return;
    }
    console.error('[process error]', err?.message || err);
  });

  return server;
}

module.exports = startServerStrict();
