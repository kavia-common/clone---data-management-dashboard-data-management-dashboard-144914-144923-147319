'use strict';

/**
 * PUBLIC_INTERFACE
 * serverRunner
 * A lightweight process-level wrapper that:
 *  - Requires the existing server entry (../server.js) without modifying app.js or security.js
 *  - Installs process listeners to gracefully handle SIGTERM/SIGINT/SIGPIPE
 *  - Logs and ignores noisy signals when appropriate
 *  - Provides a simple "graceful restart" mechanism via SIGHUP
 *
 * Usage:
 *  - Importing/require'ing this file will initialize listeners and start the server via require('../server')
 *  - This wrapper does not export the app; it ensures side-effectful startup and signal handling
 */
try { require('dotenv').config(); } catch {}

const path = require('path');

function log(msg, data) {
  try {
    if (data !== undefined) {
      // eslint-disable-next-line no-console
      console.log(`[serverRunner] ${msg}`, data);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[serverRunner] ${msg}`);
    }
  } catch {}
}

// Start the server by requiring the existing entry (side-effect export of started server instance)
let serverInstance = null;
try {
  const serverPath = path.join(__dirname, '..', 'server.js');
  // server.js exports the started server; keep a ref for graceful close on restart/shutdown
  // eslint-disable-next-line import/no-dynamic-require, global-require
  serverInstance = require(serverPath);
  log('Server required and started via ../server.js');
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[serverRunner] Failed to start server via ../server.js:', e?.message || e);
}

/**
 * Graceful shutdown routine
 */
async function gracefulShutdown(signal = 'SIGTERM', code = 0) {
  log(`${signal} received: initiating graceful shutdown`);
  try {
    if (serverInstance && typeof serverInstance.close === 'function') {
      await new Promise((resolve) => {
        try {
          serverInstance.close(() => {
            log('HTTP server closed');
            resolve();
          });
        } catch {
          resolve();
        }
      });
    }
  } catch {}
  try {
    // Ensure listeners are cleaned up
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGPIPE');
    process.removeAllListeners('SIGHUP');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  } catch {}
  process.exit(code);
}

/**
 * Graceful restart routine: close current server and re-require ../server.js
 */
async function gracefulRestart() {
  log('SIGHUP received: attempting graceful restart');
  try {
    if (serverInstance && typeof serverInstance.close === 'function') {
      await new Promise((resolve) => {
        try {
          serverInstance.close(() => {
            log('HTTP server closed for restart');
            resolve();
          });
        } catch {
          resolve();
        }
      });
    }
  } catch {}
  // Re-require server
  try {
    // Clear module from cache then require again
    const serverModulePath = require.resolve(path.join(__dirname, '..', 'server.js'));
    delete require.cache[serverModulePath];
  } catch {}
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    serverInstance = require(path.join(__dirname, '..', 'server.js'));
    log('Server restarted via ../server.js');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[serverRunner] Failed to restart server via ../server.js:', e?.message || e);
  }
}

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0));
process.on('SIGINT', () => gracefulShutdown('SIGINT', 0));

// Ignore SIGPIPE noise on certain hosts; just log once
let sigpipeLogged = false;
process.on('SIGPIPE', () => {
  if (!sigpipeLogged) {
    sigpipeLogged = true;
    log('SIGPIPE received (ignored)');
  }
});

// Allow graceful restart on SIGHUP
process.on('SIGHUP', () => { gracefulRestart(); });

// Error handlers (do not crash, just log)
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[serverRunner][uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[serverRunner][unhandledRejection]', reason);
});

module.exports = {}; // no-op export; this module is side-effectful
