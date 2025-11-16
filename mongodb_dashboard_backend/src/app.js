const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

/**
 * Mount consolidated API router
 * src/routes/index.js already wires up all core routes with proper middleware.
 */
const apiRouter = require('./routes/index');
app.use('/api', apiRouter);

/**
 * Mount proxy routes (kept separate to avoid auth middleware in index for this scope)
 */
try {
  const proxySessionTracking = require('./routes/proxy.sessionTracking');
  app.use('/api/proxy', proxySessionTracking);
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[app] proxy.sessionTracking route not mounted:', e?.message || e);
}

// Health endpoints (simple readiness/liveness)
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/ready', (req, res) => res.json({ ready: true }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

module.exports = app;
