'use strict';

/* Load environment variables early */
try { require('dotenv').config(); } catch {}

const http = require('http');
const app = require('./app');

const PORT = Number(process.env.PORT || 4000);
const HOST = (process.env.HOST && process.env.HOST !== 'localhost') ? process.env.HOST : '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Backend runtime note:
 * - Pure Express server only; no CRA/Vite/webpack dev server is started here.
 * - NODE_OPTIONS can cap memory via --max_old_space_size=256 and disable source maps for speed.
 */
const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Express API server listening on http://${HOST}:${PORT} (${NODE_ENV})`);
  console.log(`READY: http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[startup] Server failed to start:', err?.message || err);
  process.exit(1);
});

module.exports = server;
