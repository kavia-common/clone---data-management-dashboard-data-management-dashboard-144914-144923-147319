'use strict';

const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * Minimal modules overview endpoint placeholder.
 */
router.get('/', (req, res) => res.status(200).json({ items: [], total: 0 }));

module.exports = router;
