'use strict';

const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs-aggregate/by-agent
 * Returns [] as placeholder aggregation.
 */
router.get('/by-agent', (req, res) => res.status(200).json([]));

module.exports = router;
