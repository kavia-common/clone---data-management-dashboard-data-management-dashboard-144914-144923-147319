#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * Script: scripts/list_all_data.js
 * Purpose:
 *   - Connect to MongoDB using the backend's existing configuration (dotenv + src/config/db.js).
 *   - Use process.env.MONGODB_URI (with fallback in db.js) and clearly print the resolved/used URI (masked).
 *   - Determine and display the ACTUAL database name in use after connection (from mongoose.connection.name),
 *     also show the database parsed from the URI path for comparison.
 *   - List ALL collection names found in that database.
 *   - For EACH collection, fetch and print up to the first 10 documents for inspection.
 *   - Gracefully handle connection and query errors with clear console output.
 *
 * Usage:
 *   node -r dotenv/config scripts/list_all_data.js
 *   or make it executable: chmod +x scripts/list_all_data.js && ./scripts/list_all_data.js
 *
 * Environment:
 *   - MONGODB_URI (recommended) or falls back to default in src/config/db.js
 *   - MONGODB_DB (optional; overrides db name)
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
 * Print a friendly section header to make output easy to scan.
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
 * Extract database name from a MongoDB URI's pathname (e.g., /mydb -> mydb).
 * If no db name is present in the URI path, return null.
 */
function dbNameFromUriPath(uri) {
  try {
    const u = new URL(uri);
    const path = (u.pathname || '').trim(); // e.g., "/mydb"
    if (!path || path === '/') return null;
    // strip leading slash
    const name = path.startsWith('/') ? path.slice(1) : path;
    return name || null;
  } catch {
    return null;
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
    console.log('MONGODB_URI (masked):', masked);
    if (process.env.MONGODB_DB) {
      // eslint-disable-next-line no-console
      console.log('MONGODB_DB (env override for dbName):', process.env.MONGODB_DB);
    }

    // Also parse out db name from URI path for transparency
    const uriDbName = dbNameFromUriPath(rawUri);
    // eslint-disable-next-line no-console
    console.log('DB name parsed from URI path:', uriDbName || '(none in URI path)');

    // Connect using existing backend config (it logs basic connection details)
    await connectDB();

    section('Connection Info');
    const isConnected = mongoose.connection.readyState === 1;
    // eslint-disable-next-line no-console
    console.log('Connected:', isConnected ? 'YES' : 'NO');

    if (!isConnected) {
      throw new Error('Mongoose is not connected (readyState != 1).');
    }

    // Determine the effective DB name in use by Mongoose after connection.
    const effectiveDbName = mongoose.connection.name;
    let clusterHost = 'unknown-host';
    try {
      const parsed = new URL(rawUri);
      clusterHost = parsed.hostname || clusterHost;
    } catch {
      // ignore parse errors
    }

    // eslint-disable-next-line no-console
    console.log('Cluster Host:', clusterHost);
    // eslint-disable-next-line no-console
    console.log('Effective DB Name (from mongoose.connection.name):', effectiveDbName);

    // Provide a clear summary of how db was chosen
    if (process.env.MONGODB_DB) {
      // eslint-disable-next-line no-console
      console.log('Note: DB name is set via MONGODB_DB, which overrides any db in the URI.');
    } else if (uriDbName) {
      // eslint-disable-next-line no-console
      console.log('Note: No MONGODB_DB override; DB name comes from the URI path.');
    } else {
      // eslint-disable-next-line no-console
      console.log('Note: No DB specified in env or URI path; MongoDB driver default is used (often "test" on some setups).');
    }

    section('Collections');
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map((c) => c.name).sort();
    if (collectionNames.length === 0) {
      // eslint-disable-next-line no-console
      console.log(`No collections found in database "${effectiveDbName}".`);
      // eslint-disable-next-line no-console
      console.log('Tip: Start the server and call GET /api/dev/seed to insert demo data, then re-run this script.');
    } else {
      // eslint-disable-next-line no-console
      console.log(`Found ${collectionNames.length} collection(s) in "${effectiveDbName}":`);
      // eslint-disable-next-line no-console
      collectionNames.forEach((n, idx) => console.log(`  ${idx + 1}. ${n}`));
    }

    // For each collection, show the first 10 documents
    for (const name of collectionNames) {
      section(`Data Preview: ${name}`);
      try {
        const docs = await fetchFirstNFromCollection(name, 10);
        // eslint-disable-next-line no-console
        console.log(`Showing ${docs.length} document(s) (max 10) from "${name}" in "${effectiveDbName}":`);
        // Pretty-print each document on its own for readability
        if (docs.length === 0) {
          // eslint-disable-next-line no-console
          console.log('  (no documents)');
        } else {
          docs.forEach((doc, i) => {
            // eslint-disable-next-line no-console
            console.log(`  #${i + 1}: ${JSON.stringify(doc, null, 2)}`);
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Error reading from collection "${name}":`, err.message);
      }
    }

    section('Summary');
    // eslint-disable-next-line no-console
    console.log('Connected to cluster host:', clusterHost);
    // eslint-disable-next-line no-console
    console.log('Database name in use:', effectiveDbName);
    // eslint-disable-next-line no-console
    console.log('Collections:', collectionNames.length > 0 ? collectionNames : '(none)');

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
