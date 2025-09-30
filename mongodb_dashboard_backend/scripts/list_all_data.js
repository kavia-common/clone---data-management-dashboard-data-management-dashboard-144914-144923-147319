#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * Script: scripts/list_all_data.js
 * Purpose:
 *   - Connect to MongoDB using the backend's existing configuration (dotenv + src/config/db.js).
 *   - Use process.env.MONGODB_URI (with fallback in db.js) and clearly print the resolved/used URI (masked).
 *   - Report the actual connected database name (mongoose.connection.name).
 *   - List ALL collection names found in the connected database.
 *   - For EACH collection, fetch and print up to the first 10 documents for inspection.
 *   - Gracefully handle connection and query errors with clear console output.
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

/**
 * Print a friendly section header
 */
function section(title) {
  // eslint-disable-next-line no-console
  console.log('\n=== ' + title + ' ===');
}

/**
 * Mask credentials in MongoDB URI for safe logging.
 * - Preserves protocol and host
 * - Masks username/password if present
 * - Leaves query string as-is
 */
function maskMongoUri(uri) {
  try {
    const u = new URL(uri);
    const user = u.username ? '***' : '';
    const pass = u.password ? '***' : '';
    const auth = u.username || u.password ? `${user}:${pass}@` : '';
    return `${u.protocol}//${auth}${u.host}${u.pathname || ''}${u.search || ''}`;
  } catch {
    return '<invalid-uri>';
  }
}

/**
 * Read first N documents from a collection using the native driver to avoid schema constraints.
 */
async function fetchFirstNFromCollection(collectionName, n = 10) {
  const coll = mongoose.connection.db.collection(collectionName);
  const docs = await coll.find({}).limit(n).toArray();
  return docs;
}

async function main() {
  try {
    section('MongoDB Connectivity Check');

    const rawUri =
      process.env.MONGODB_URI ||
      'mongodb+srv://govindarajmalaiarasu_db_user:MGRaj2005@phaseonedata.qlyhyxu.mongodb.net/?retryWrites=true&w=majority&appName=PhaseOneData';
    const masked = maskMongoUri(rawUri);

    // eslint-disable-next-line no-console
    console.log('Environment MONGODB_URI (masked):', masked);
    if (process.env.MONGODB_DB) {
      // eslint-disable-next-line no-console
      console.log('Environment MONGODB_DB (override dbName):', process.env.MONGODB_DB);
    }

    // Connect using existing backend config (it logs basic connection details)
    await connectDB();

    section('Connection Info');
    const isConnected = mongoose.connection.readyState === 1;
    // eslint-disable-next-line no-console
    console.log('Connected:', isConnected ? 'YES' : 'NO');
    // Actual resolved DB name from mongoose
    // eslint-disable-next-line no-console
    console.log('Resolved DB Name:', mongoose.connection.name);
    // Print effective cluster host derived from URI
    try {
      const parsed = new URL(rawUri);
      // eslint-disable-next-line no-console
      console.log('Cluster Host:', parsed.hostname || 'unknown-host');
    } catch {
      // eslint-disable-next-line no-console
      console.log('Cluster Host:', 'unknown-host');
    }

    if (!isConnected) {
      throw new Error('Mongoose is not connected (readyState != 1).');
    }

    section('Collections');
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map((c) => c.name).sort();
    if (collectionNames.length === 0) {
      // eslint-disable-next-line no-console
      console.log('No collections found in database:', mongoose.connection.name);
      // eslint-disable-next-line no-console
      console.log('Tip: Start the server and call GET /api/dev/seed to insert demo data, then re-run this script.');
    } else {
      // eslint-disable-next-line no-console
      console.log('Found collections:', collectionNames);
    }

    // For each collection, show the first 10 documents
    for (const name of collectionNames) {
      section(`Data Preview: ${name}`);
      try {
        const docs = await fetchFirstNFromCollection(name, 10);
        // eslint-disable-next-line no-console
        console.log(`Showing ${docs.length} document(s) (max 10) from "${name}":`);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(docs, null, 2));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Error reading from collection "${name}":`, err.message);
      }
    }

    section('Result');
    // eslint-disable-next-line no-console
    console.log('MongoDB listing script finished.');
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
