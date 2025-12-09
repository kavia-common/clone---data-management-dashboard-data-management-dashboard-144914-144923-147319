const express = require('express');
const router = express.Router();

// Mount users routes, including /summary
const usersSummaryRoutes = require('./users.summary');

router.use('/users', usersSummaryRoutes);

// Explicitly disable root GET / to prevent Overview or any client from calling backend root.
// This avoids accidental reliance on a legacy endpoint like GET /?organization_id=...
router.get('/', (req, res) => {
  return res.status(404).json({
    success: false,
    message: 'Root endpoint disabled. Use documented /api/* routes (see /api-docs).',
  });
});

module.exports = router;
