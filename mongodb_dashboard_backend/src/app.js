'use strict';

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const routes = require('./routes');

/**
 * PUBLIC_INTERFACE
 * createApp
 * Returns an Express app with basic security, logging, health route and the main /api router.
 */
function createApp() {
  const app = express();

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // CORS (permissive for development)
  app.use(cors());

  // Logging
  app.use(morgan('dev'));

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Health endpoint that does not require DB
  app.get('/health', (req, res) => {
    res.json({ ok: true, db: !!req.app.locals.db });
  });

  // Main API router
  app.use('/api', routes);

  // Also expose a lightweight health check at /api/health that does not require DB
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, db: !!req.app.locals.db });
  });

  // Basic not found handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Basic error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal Server Error' });
  });

  return app;
}

module.exports = { createApp };
