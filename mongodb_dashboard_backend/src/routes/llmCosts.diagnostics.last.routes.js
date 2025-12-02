"use strict";

const express = require("express");
const router = express.Router();
const { getLastLlmCostsDiagnostics } = require("../controllers/llmCosts.diagnostics.last.controller");

/**
 * PUBLIC_INTERFACE
 * @swagger
 * /api/llm-costs/diagnostics/last:
 *   get:
 *     summary: Last diagnostics for LLM costs list
 *     description: Returns the last captured diagnostics information for the /api/llm-costs request handler, including effective filter, projection, sort, timings and any explain metadata when enabled.
 *     tags:
 *       - LLMCosts
 *     responses:
 *       200:
 *         description: Last diagnostics payload (or null if none captured yet)
 *       500:
 *         description: Diagnostics unavailable
 */
router.get("/diagnostics/last", getLastLlmCostsDiagnostics);

module.exports = router;
