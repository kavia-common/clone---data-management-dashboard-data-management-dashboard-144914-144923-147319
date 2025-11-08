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
    console.log(`[Server] Listening on http://${HOST}:${PORT} (bind=0.0.0.0 compatible)`);
    console.log('[Server] Ready. Health endpoints: GET /health and GET /api/health');
  });

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  });
}

module.exports = { start };
