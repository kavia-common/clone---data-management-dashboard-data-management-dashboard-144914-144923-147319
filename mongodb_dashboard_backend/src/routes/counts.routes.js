'use strict';

const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * Lightweight counts endpoints (public)
 */
router.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

module.exports = router;
