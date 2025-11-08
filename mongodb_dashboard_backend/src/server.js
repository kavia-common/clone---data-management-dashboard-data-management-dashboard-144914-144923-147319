'use strict';

require('dotenv').config();

const http = require('http');
const { createApp } = require('./app');
const { connect } = require('./config/db');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '3001', 10);

/**
 * PUBLIC_INTERFACE
 * start
 * Bootstraps the HTTP server and attempts a non-blocking DB connection.
 */
async function start() {
  const app = createApp();

  // Attempt DB connection asynchronously; expose db in app.locals if available.
  (async () => {
    const { db } = await connect(console);
    if (db) {
      app.locals.db = db;
    }
  })();

  const server = http.createServer(app);
  server.listen(PORT, HOST, () => {
    // Clear, stable readiness log for preview detectors
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
    console.log('[Server] Ready. Health endpoints: GET /health and GET /api/health');
  });

  // Handle server errors without exiting; keep process alive and log the issue
  server.on('error', (err) => {
    console.error('[Server] Error event:', err && err.message ? err.message : err);
  });

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[Server] Failed to start:', err && err.message ? err.message : err);
    // Do not exit; allow process to stay up so health endpoint can be probed
    // A subsequent hot-reload or environment fix can recover without killing the container.
  });
}

module.exports = { start };
