/* Ensure environment variables from .env are loaded even if the process
 * is started without "-r dotenv/config" (e.g., by external orchestrators). */
try { require('dotenv').config(); } catch {}

const app = require('./app');
const mongoose = require('mongoose');
const { connectDB } = require('./config/db');

// Bind config
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Early startup banner
try {
  // eslint-disable-next-line no-console
  console.log(`[startup] Booting Dashboard API (env=${process.env.NODE_ENV || 'development'}) on ${HOST}:${PORT}`);
} catch {}

// Attempt DB connect but do not fail server if it errors
(async () => {
  try {
    await connectDB();
  } catch (err) {
    try {
      // eslint-disable-next-line no-console
      console.warn('[startup] DB connect failed (non-fatal):', err?.message || err);
    } catch {}
  }
})();

const server = app
  .listen(PORT, HOST, () => {
    const ready = mongoose.connection.readyState;
    const dbState = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
    const dbName = mongoose.connection?.name || '(n/a)';
    try {
      console.log(`[startup] Listening on http://${HOST}:${PORT}`);
      console.log(`[startup] Health: http://${HOST}:${PORT}/health  /api/health  Docs: http://${HOST}:${PORT}/docs`);
      console.log(`[startup] DB status at boot: ${dbState} (db: ${dbName})`);
    } catch {}
  })
  .on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      try { console.error(`[startup] Port ${PORT} in use. If another process is listening, stop it or change PORT.`); } catch {}
    } else {
      try { console.error('[startup] Server failed to start:', err); } catch {}
    }
    // Exit so orchestrator/CI can restart
    process.exit(1);
  });

// Graceful shutdown
const shutdown = (signal) => {
  try { console.log(`${signal} received: closing HTTP server`); } catch {}
  server.close(async () => {
    try { console.log('HTTP server closed'); } catch {}
    try {
      await mongoose.connection.close();
      try { console.log('MongoDB connection closed'); } catch {}
    } catch (e) {
      try { console.error('Error closing MongoDB connection', e?.message || e); } catch {}
    }
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Log unexpected errors to avoid silent crashes during startup/runtime
process.on('unhandledRejection', (reason) => {
  try { console.error('[unhandledRejection]', reason); } catch {}
});
process.on('uncaughtException', (err) => {
  try { console.error('[uncaughtException]', err); } catch {}
});

module.exports = server;
