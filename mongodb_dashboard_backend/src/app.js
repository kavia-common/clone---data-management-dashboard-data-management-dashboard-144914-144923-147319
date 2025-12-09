const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// DB injection middleware placeholder; in real project, should be set up elsewhere
app.set('db', (global.__DB__ && global.__DB__.db) || { collection: () => ({ aggregate: async () => ({ toArray: async () => [] }) }) });

// Routes
const routes = require('./routes');
app.use('/api', routes);

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

module.exports = app;
