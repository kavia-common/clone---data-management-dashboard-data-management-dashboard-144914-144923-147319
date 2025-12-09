const express = require('express');
const router = express.Router();

// Mount users routes, including /summary
const usersSummaryRoutes = require('./users.summary');

router.use('/users', usersSummaryRoutes);

module.exports = router;
