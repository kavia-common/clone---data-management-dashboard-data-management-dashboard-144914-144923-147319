'use strict';

const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * Basic placeholder routes for projects to avoid startup failures.
 */
router.get('/', (req, res) => res.status(200).json([]));

module.exports = router;
