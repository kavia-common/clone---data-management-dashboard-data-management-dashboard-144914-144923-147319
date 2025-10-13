import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

dotenv.config();

/**
 * Create and configure Express app with middleware and routes.
 * - JSON parsing, CORS, security headers
 * - Health endpoints
 * - API namespace: /api
 */
export function createApp() {
  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  // Root health route (frontend may call "/")
  app.get("/", (_req, res) => {
    res.json({ ok: true, name: "mongodb_dashboard_backend" });
  });

  // API router
  const api = express.Router();

  // PUBLIC_INTERFACE
  api.get("/users", (_req, res) => {
    /** List users placeholder; returns empty list and meta. */
    res.json({ success: true, data: [], meta: { total: 0 } });
  });

  // PUBLIC_INTERFACE
  api.delete("/users/:id", (req, res) => {
    /** Delete user placeholder by id; always returns success. */
    res.json({ success: true, data: { id: req.params.id, deleted: true } });
  });

  // PUBLIC_INTERFACE
  api.get("/session-tracking", (_req, res) => {
    /** List sessions placeholder; returns empty list and meta. */
    res.json({ success: true, data: [], meta: { total: 0 } });
  });

  // PUBLIC_INTERFACE
  api.delete("/session-tracking/:id", (req, res) => {
    /** Delete session placeholder by id; always returns success. */
    res.json({ success: true, data: { id: req.params.id, deleted: true } });
  });

  // PUBLIC_INTERFACE
  api.get("/app-deployments", (_req, res) => {
    /** List deployments placeholder; returns empty list and meta. */
    res.json({ success: true, data: [], meta: { total: 0 } });
  });

  // PUBLIC_INTERFACE
  api.delete("/app-deployments/:id", (req, res) => {
    /** Delete deployment placeholder by id; always returns success. */
    res.json({ success: true, data: { id: req.params.id, deleted: true } });
  });

  app.use("/api", api);

  // 404 handler for API
  app.use("/api", (_req, res) => res.status(404).json({ success: false, message: "Not Found" }));

  // Error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  });

  return app;
}
