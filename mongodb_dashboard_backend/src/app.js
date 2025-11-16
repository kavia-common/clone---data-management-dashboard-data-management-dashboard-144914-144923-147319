const express = require('express');
const { corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security');

const app = express();

// Security and common middleware
app.use(helmetMiddleware());
app.use(corsMiddleware());
app.use(express.json());
app.use(rateLimiter());

// Central router (contains most API mounts and docs)
let indexRouter = null;
try {
  indexRouter = require('./routes/index');
} catch {
  indexRouter = null;
}

// Explicit proxy router
let proxySessionTracking = null;
try {
  proxySessionTracking = require('./routes/proxy.sessionTracking');
} catch {
  proxySessionTracking = null;
}

// Mount central /api routes if available
if (indexRouter) {
  app.use('/api', indexRouter);
}

// Ensure proxy is mounted at /api/proxy even if central index is not used
if (proxySessionTracking) {
  app.use('/api/proxy', proxySessionTracking);
}

// Health endpoints
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/ready', (req, res) => res.json({ ready: true }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

module.exports = app;
