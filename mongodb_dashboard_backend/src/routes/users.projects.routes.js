'use strict';

const express = require('express');
const router = express.Router();

// Import after controller is created
const { getUserProjects } = require('../controllers/users.projects.controller');

// Route: mounted under /api/users in users.routes.js; final path: /api/users/:userId/projects
router.get('/:userId/projects', getUserProjects);

module.exports = router;
