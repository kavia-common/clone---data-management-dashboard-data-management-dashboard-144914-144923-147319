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
// Always bind 0.0.0.0 to avoid EADDRNOTAVAIL in container/preview envs when frontend proxy targets localhost
let HOST = (process.env.HOST && process.env.HOST !== 'localhost') ? process.env.HOST : '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Guard: if a conflicting HOST like 127.0.0.1/localhost slips through in container, normalize to 0.0.0.0
if (['localhost', '127.0.0.1', '::1'].includes(String(process.env.HOST || '').toLowerCase())) {
  try { console.warn(`[startup] Overriding HOST=${process.env.HOST} to 0.0.0.0 to prevent EADDRNOTAVAIL in container environments`); } catch {}
  HOST = '0.0.0.0';
}

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
  // Configure server-level timeouts to play nicely with proxies/load balancers
  try {
    // Note: These will be applied after server is created below
    // Defaults are too low under certain proxy chains; increase conservatively
  } catch {}
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
        // Readiness markers
        console.log(`READY: http://${HOST}:${PORT}`);
        console.log(`BACKEND_READY: url=http://${HOST}:${PORT}`);
        console.log(`Listening on http://${HOST}:${PORT}`);

        // Diagnostic hints for common dev proxy pitfalls
        const proxyEnv = {
          FRONTEND_PROXY: process.env.FRONTEND_PROXY,
          PROXY_TARGET: process.env.PROXY_TARGET,
        };
        if (proxyEnv.FRONTEND_PROXY || proxyEnv.PROXY_TARGET) {
          console.log('[diagnostics] Detected proxy-related envs:', proxyEnv);
          console.log('[diagnostics] Ensure frontend proxies to http://localhost:3001 only from the browser context; do not run HPM inside this backend.');
        }
      } catch {}
      writePidFile();
    })
    .on('error', (err) => {
      const code = err && err.code;
      if (code === 'EADDRINUSE') {
        console.error(`[startup] EADDRINUSE on ${HOST}:${PORT}. Another process is using this port. If running nodemon, ensure no double-listen. PID file: ${PID_FILE}`);
      } else if (code === 'EADDRNOTAVAIL') {
        console.error(`[startup] EADDRNOTAVAIL for ${HOST}. Hint: set HOST=0.0.0.0 (current HOST=${HOST}). In containers, binding to localhost can fail.`);
      } else {
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

  // Apply safe Node server timeouts
  try {
    // Align with upstream gateway: keepAlive 120s, headers 125s
    server.keepAliveTimeout = 120000;
    server.headersTimeout = 125000;   // must be greater than keepAliveTimeout
    console.log(`[startup] Server timeouts set: keepAliveTimeout=${server.keepAliveTimeout}ms headersTimeout=${server.headersTimeout}ms`);
  } catch (e) {
    console.warn('[startup] Failed to set server timeouts', e?.message || e);
  }

  // Add a per-request timeout for the LLM costs route to gracefully abort long requests
  try {
    const llmCostsTimeoutMs = 120000; // 120s to exceed common 504 thresholds
    app.use('/api/llm-costs', (req, res, next) => {
      const start = Date.now();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          res.set('X-Timeout-Applied', 'true');
          res.set('X-Route-Timeout', String(llmCostsTimeoutMs));
          res.set('X-Query-Duration', String(Date.now() - start));
          res.set('X-Query-Path', '/api/llm-costs');
        } catch (_) {}
        if (!res.headersSent) {
          return res.status(504).json({ success: false, message: 'Gateway Timeout: LLM costs query exceeded time limit' });
        }
      }, llmCostsTimeoutMs);
      res.on('finish', () => {
        try {
          res.set('X-Query-Duration', String(Date.now() - start));
        } catch (_) {}
        clearTimeout(timer);
      });
      res.on('close', () => clearTimeout(timer));
      if (!timedOut) next();
    });
  } catch (e) {
    console.warn('[startup] Failed to attach per-route timeout middleware for /api/llm-costs', e?.message || e);
  }

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