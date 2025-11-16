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
 * session-tracking proxy has been removed; frontend calls the external API directly now.
 * Intentionally not mounting ./routes/proxy.sessionTracking
 */

// Health endpoints (simple readiness/liveness)
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/ready', (req, res) => res.json({ ready: true }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

module.exports = app;
