"use strict";

const express = require("express");
const router = express.Router();

const { listAppDeployments } = require("../controllers/appDeployments.controller");

// Route: GET /api/app-deployments
router.get("/app-deployments", listAppDeployments);

module.exports = router;
