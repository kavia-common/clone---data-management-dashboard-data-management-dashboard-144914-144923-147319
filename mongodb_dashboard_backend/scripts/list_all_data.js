#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * Script: scripts/list_all_data.js
 * Purpose:
 *   - Connects to MongoDB using the backend's existing configuration (dotenv + src/config/db.js).
 *   - Attempts to read and print documents from a representative collection in priority order:
 *       1) users
 *       2) session_tracking
 *       3) app_deployments
 *       4) sample
 *   - If none of the above collections exist, lists available collections and exits.
 *   - Gracefully handles connection and query errors with clear console output.
 *
 * Usage:
 *   node -r dotenv/config scripts/list_all_data.js
 *   or make it executable: chmod +x scripts/list_all_data.js && ./scripts/list_all_data.js
 *
 * Environment:
 *   - MONGODB_URI (recommended) or falls back to default in src/config/db.js
 *   - MONGODB_DB (optional)
 *   - MONGOOSE_AUTO_INDEX (optional)
 */

const path = require('path');
const mongoose = require('mongoose');

// Ensure dotenv is loaded when not using -r dotenv/config
if (!process.env.DOTENV_CONFIG_PATH) {
  // Load .env from project root of backend
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const { connectDB } = require('../src/config/db');

// Import models so we can query them directly
const User = require('../src/models/user.model');
const SessionTracking = require('../src/models/sessionTracking.model');
const AppDeployment = require('../src/models/appDeployments.model');
const Sample = require('../src/models/sample.model');

/**
 * Print a friendly section header
 */
function section(title) {
  // eslint-disable-next-line no-console
  console.log('\n=== ' + title + ' ===');
}

/**
 * Print documents with capped count and pretty formatting
 */
function printDocs(label, docs, cap = 10) {
  const toShow = Array.isArray(docs) ? docs.slice(0, cap) : [];
  // eslint-disable-next-line no-console
  console.log(`${label}: showing ${toShow.length} of ${docs.length}`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(toShow, null, 2));
}

/**
 * Determine if a collection exists in the current database.
 */
async function collectionExists(name) {
  const collections = await mongoose.connection.db.listCollections({ name }).toArray();
  return collections.length > 0;
}

/**
 * Try fetching from a collection using a model, with safety and logging.
 */
async function tryFetch(name, model, sort = { _id: -1 }, limit = 50) {
  const exists = await collectionExists(name);
  if (!exists) {
    // eslint-disable-next-line no-console
    console.log(`Collection "${name}" does not exist (skipping).`);
    return null;
  }
  // eslint-disable-next-line no-console
  console.log(`Querying collection "${name}"...`);
  const docs = await model.find({}).sort(sort).limit(limit).lean();
  return docs;
}

async function main() {
  try {
    section('MongoDB Connectivity Check');

    // Show which URI host is being used (mask credentials)
    const uri = process.env.MONGODB_URI ||
      'mongodb+srv://govindarajmalaiarasu_db_user:MGRaj2005@phaseonedata.qlyhyxu.mongodb.net/?retryWrites=true&w=majority&appName=PhaseOneData';
    let host = 'unknown-host';
    try {
      const parsed = new URL(uri);
      host = parsed.hostname || host;
    } catch { /* ignore */ }

    // Connect using existing backend config (logs connection details)
    await connectDB();

    section('Connection Info');
    // eslint-disable-next-line no-console
    console.log('Connected:', mongoose.connection.readyState === 1 ? 'YES' : 'NO');
    // eslint-disable-next-line no-console
    console.log('DB Name:', mongoose.connection.name);
    // eslint-disable-next-line no-console
    console.log('Cluster Host:', host);

    section('Data Listing');

    // Priority order of representative collections
    const attempts = [
      { name: 'users', model: User, sort: { created_at: -1 } },
      { name: 'session_tracking', model: SessionTracking, sort: { session_start: -1 } },
      { name: 'app_deployments', model: AppDeployment, sort: { created_at: -1 } },
      { name: 'sample', model: Sample, sort: { created_at: -1 } },
    ];

    let anyListed = false;
    for (const { name, model, sort } of attempts) {
      try {
        const docs = await tryFetch(name, model, sort, 50);
        if (docs && docs.length >= 0) {
          anyListed = true;
          printDocs(`Collection "${name}"`, docs, 10);
          // Stop at the first successful collection with at least 0 results to prove connectivity.
          break;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Error querying "${name}":`, err.message);
      }
    }

    if (!anyListed) {
      // No target collection found; list available collections to guide the user
      section('No Target Collections Found');
      const list = await mongoose.connection.db.listCollections().toArray();
      const names = list.map((c) => c.name).sort();
      if (names.length === 0) {
        // eslint-disable-next-line no-console
        console.log('No collections found in this database.');
      } else {
        // eslint-disable-next-line no-console
        console.log('Available collections:', names);
        // Suggest trying one of them manually
        // eslint-disable-next-line no-console
        console.log('Tip: Add data using GET /api/dev/seed while the server is running, then re-run this script.');
      }
    }

    section('Result');
    // eslint-disable-next-line no-console
    console.log('MongoDB connectivity and listing script finished.');
    await mongoose.connection.close();
    // eslint-disable-next-line no-console
    console.log('MongoDB connection closed. Bye.');
    process.exit(0);
  } catch (err) {
    section('Error');
    // eslint-disable-next-line no-console
    console.error('Failed to verify MongoDB connectivity:', err.message);
    try {
      await mongoose.connection.close();
      // eslint-disable-next-line no-console
      console.log('MongoDB connection closed after error.');
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
