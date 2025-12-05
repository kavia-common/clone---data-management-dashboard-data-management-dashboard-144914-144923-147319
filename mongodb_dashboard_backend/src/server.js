/* Ensure environment variables from .env are loaded */
try { require('dotenv').config(); } catch {}

const app = require('./app');
const http = require('http');
const mongoose = require('mongoose');

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  try {
    const dbName = mongoose?.connection?.db?.databaseName || process.env.MONGODB_DB || '(not connected)';
    console.log('[startup] DB:', dbName);
  } catch {}
});

// Diagnostics helpers
function logMemoryUsage(prefix = 'mem') {
  try {
    const mu = process.memoryUsage();
    console.warn(`[diagnostics:${prefix}] rss=${mu.rss} heapTotal=${mu.heapTotal} heapUsed=${mu.heapUsed} external=${mu.external}`);
  } catch {}
}

process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err?.stack || err);
  if (err && /ENOMEM|heap out of memory|allocation failed/i.test(String(err.message || err))) {
    console.error('[process] Detected possible OOM (ENOMEM/heap out of memory). Increase memory or optimize queries.');
  }
  logMemoryUsage('uncaughtException');
  setTimeout(() => process.exit(1), 250);
});

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason);
  logMemoryUsage('unhandledRejection');
});

process.on('SIGTERM', () => {
  console.warn('[process] SIGTERM received. Graceful shutdown starting...');
  logMemoryUsage('SIGTERM');
  server.close(async () => {
    console.warn('[process] HTTP server closed. Exiting.');
    try { await mongoose.connection.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
});

process.on('SIGINT', () => {
  console.warn('[process] SIGINT received. Graceful shutdown starting...');
  logMemoryUsage('SIGINT');
  server.close(async () => {
    console.warn('[process] HTTP server closed. Exiting.');
    try { await mongoose.connection.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
});

// Optional periodic memory logs
if (process.env.DEBUG_MEMORY_LOG === '1') {
  setInterval(() => logMemoryUsage('interval'), 30000).unref();
}

module.exports = server;
