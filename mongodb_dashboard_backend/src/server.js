const app = require('./app');
const mongoose = require('mongoose');
const { connectDB } = require('./config/db');

// Default to 3001 to match container deployment and docs URL
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// PUBLIC_INTERFACE
async function startServer() {
  /**
   * Ensure MongoDB is connected BEFORE starting to accept HTTP requests.
   * Adds retries and clear diagnostics so routes using Mongoose don't buffer and time out.
   */
  const maxRetries = parseInt(process.env.DB_CONNECT_RETRIES || '3', 10);
  const retryDelayMs = parseInt(process.env.DB_CONNECT_RETRY_DELAY_MS || '1500', 10);

  // Fail-fast if env is clearly misconfigured (no override set)
  if (!process.env.MONGODB_URI) {
    // eslint-disable-next-line no-console
    console.warn('[startup] MONGODB_URI is not set. The app will try a built-in default which may not be accessible from this environment. Define MONGODB_URI in .env for reliability.');
  }

  let attempt = 0;
  let connected = false;
  let lastError;
  while (attempt <= maxRetries && !connected) {
    try {
      attempt += 1;
      // eslint-disable-next-line no-console
      console.log(`[startup] Connecting to MongoDB (attempt ${attempt}/${maxRetries + 1}) ...`);
      await connectDB();
      connected = true;
      // eslint-disable-next-line no-console
      console.log('[startup] MongoDB connection established.');
    } catch (err) {
      lastError = err;
      // eslint-disable-next-line no-console
      console.error(`[startup] MongoDB connection attempt ${attempt} failed: ${err?.message || err}`);
      if (attempt <= maxRetries) {
        // eslint-disable-next-line no-console
        console.log(`[startup] Retrying MongoDB connection in ${retryDelayMs}ms ...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  if (!connected) {
    // eslint-disable-next-line no-console
    console.error('[startup] Failed to connect to MongoDB after retries. Exiting. Last error:', lastError?.message || lastError);
    process.exit(1);
  }

  const server = app
    .listen(PORT, HOST, () => {
      // eslint-disable-next-line no-console
      console.log(
        `[startup] Express listening on http://${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`
      );
    })
    .on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        // eslint-disable-next-line no-console
        console.error(
          `[startup] Port ${PORT} is already in use. Ensure no other process is running on this port.`
        );
      } else {
        // eslint-disable-next-line no-console
        console.error('[startup] Server failed to start:', err);
      }
      // Exit so orchestrator/CI can restart
      process.exit(1);
    });

  // Graceful shutdown
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
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

module.exports = startServer();
