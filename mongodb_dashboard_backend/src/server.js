import http from "http";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { createApp } from "./app.js";

dotenv.config();

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || "";

// Initialize app
const app = createApp();
const server = http.createServer(app);

// Connect to MongoDB if URI provided; otherwise, continue without DB for previews.
async function start() {
  try {
    if (MONGODB_URI) {
      mongoose.set("strictQuery", true);
      await mongoose.connect(MONGODB_URI, { dbName: process.env.MONGODB_DB || undefined });
      console.log("MongoDB connected");
    } else {
      console.warn("MONGODB_URI not set; starting without database connection.");
    }

    server.listen(PORT, () => {
      console.log(`Backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Startup error:", err?.message || err);
    process.exit(1);
  }
}

start();
