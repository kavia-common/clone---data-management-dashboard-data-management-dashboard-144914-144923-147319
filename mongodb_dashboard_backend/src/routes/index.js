"use strict";

const express = require("express");
const router = express.Router();

// Existing users summary routes previously mounted here
const usersSummaryRoutes = require("./users.summary");
router.use("/users", usersSummaryRoutes);

// Mount restored App Deployments route providing /api/app-deployments
router.use("/", require("./appDeployments.routes"));

// Keep other route mounts if they exist in the project structure (defensive no-ops if missing)
try { router.use("/analytics", require("./analytics")); } catch {}
try { router.use("/session", require("./session.routes")); } catch {}
try { router.use("/session-tracking", require("./sessionTracking.routes")); } catch {}
try { router.use("/session-tracking", require("./sessionTracking.composite.routes")); } catch {}
try { router.use("/llm-costs", require("./llmCosts.routes")); } catch {}
try { router.use("/llm-costs", require("./llmCosts.aggregate.routes")); } catch {}
try { router.use("/llm-costs", require("./llmCosts.hierarchy.routes")); } catch {}
try { router.use("/projects", require("./projects.routes")); } catch {}
try { router.use("/auth", require("./auth.routes")); } catch {}
try { router.use("/users", require("./users.routes")); } catch {}
try { router.use("/users", require("./users.analytics.summary.routes")); } catch {}
try { router.use("/users", require("./users.projects.single.routes")); } catch {}
try { router.use("/users", require("./users.projects.batch.routes")); } catch {}
try { router.use("/counts", require("./counts.routes")); } catch {}
try { router.use("/dashboard", require("./dashboard.routes")); } catch {}
try { router.use("/dashboard-modules", require("./dashboard.modules.routes")); } catch {}
try { router.use("/llm-costs-public", require("./llmCosts.public.routes")); } catch {}
try { router.use("/dev", require("./dev.routes")); } catch {}
try { router.use("/dev-verify", require("./dev.verify.routes")); } catch {}
try { router.use("/tenants", require("./tenants.routes")); } catch {}
try { router.use("/tenant-sample", require("./tenantSample.routes")); } catch {}

module.exports = router;
