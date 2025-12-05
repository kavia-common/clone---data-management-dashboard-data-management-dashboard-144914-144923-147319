'use strict';

const express = require('express');
const router = express.Router();
const { listLlmCosts } = require('../controllers/llmCosts.fallback.controller');

// PUBLIC_INTERFACE
router.get('/', listLlmCosts);

module.exports = router;
