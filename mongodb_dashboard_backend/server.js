"use strict";

/**
 * Server entrypoint with readiness logs, fast health endpoint, and graceful shutdown.
 * Logs "BACKEND_READY url=http://<host>:<port>" when the server is actually listening.
 *
 * PUBLIC_INTERFACE
 * This file is the Node.js entrypoint for the backend.
 */
const fs = require('fs');
const path = require('path');
const app = require('./src/app');

const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_PORT = Number(process.env.PORT || 3001);

// Ensure a lightweight health endpoint is present (no DB roundtrip).
function ensureHealthRoute(expressApp) {
  const hasHealth =
    expressApp &&
    expressApp._router &&
    expressApp._router.stack &&
    expressApp._router.stack.some(
      (l) =>
        l?.route?.path &&
        (l.route.path === '/health' || l.route.path === '/api/health') &&
        l.route.methods?.get
    );

  if (!hasHealth) {
    // PUBLIC_INTERFACE
    expressApp.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok', service: 'backend', timestamp: new Date().toISOString() });
    });
    expressApp.get('/api/health', (req, res) => {
      res.status(200).json({ status: 'ok', service: 'backend', timestamp: new Date().toISOString() });
    });
  }
}
ensureHealthRoute(app);

// Start server with optional port fallback if EADDRINUSE
function startServer(startPort, maxAttempts = 3) {
  let attempts = 0;
  let currentPort = startPort;
  let server;

  return new Promise((resolve, reject) => {
    const tryListen = () => {
      attempts += 1;
      server = app
        .listen(currentPort, HOST, () => {
          // PID file after server starts
          const pidDir = path.join(__dirname, '.tmp');
          const pidFile = path.join(pidDir, `server.${currentPort}.pid`);
          try {
            if (!fs.existsSync(pidDir)) fs.mkdirSync(pidDir);
            fs.writeFileSync(pidFile, String(process.pid));
          } catch {
            // ignore pid write failures
          }

          const url = `http://localhost:${currentPort}`;
          console.log(`READY: ${url}`);
          console.log(`BACKEND_READY url=${url}`);
          console.log(`Docs: ${url}/api/docs`);
          resolve({ server, port: currentPort, pidFile });
        })
        .on('error', (err) => {
          if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
            currentPort += 1; // try next port
            setTimeout(tryListen, 100);
          } else {
            reject(err);
          }
        });
    };
    tryListen();
  });
}

// Graceful shutdown and PID cleanup
function setupGracefulShutdown(server, pidFile) {
  const cleanup = () => {
    if (server) {
      server.close(() => {
        if (pidFile && fs.existsSync(pidFile)) {
          try {
            fs.unlinkSync(pidFile);
          } catch {}
        }
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 5000).unref();
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    cleanup();
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    cleanup();
  });
}

// Boot
(async () => {
  try {
    const { server, pidFile } = await startServer(DEFAULT_PORT);
    setupGracefulShutdown(server, pidFile);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
