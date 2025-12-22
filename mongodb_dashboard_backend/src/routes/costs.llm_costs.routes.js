'use strict';
/**
 * PUBLIC_INTERFACE
 * Router for legacy underscore endpoint: /api/llm_costs
 * This forwards to the same handler as src/routes/llm_costs.routes.js to avoid duplication.
 * Ensures GET /api/llm_costs returns 200 with { success, data, meta } even when empty.
 */
const express = require('express');
const forwardedRouter = require('./llm_costs.routes'); // reuse implemented routes

// PUBLIC_INTERFACE
// Expose the forwarded router directly so mounting this file behaves identically.
module.exports = forwardedRouter;
