'use strict';

/**
 * PUBLIC_INTERFACE
 * Minimal script to output the current OpenAPI JSON to stdout or a file.
 * Usage:
 *  - node generate_openapi.js > openapi.json
 *  - node generate_openapi.js ./interfaces/openapi.generated.json
 */
const fs = require('fs');
const path = require('path');

function main() {
  // Load the base spec via the swagger builder
  const { getBaseOpenApiSpec } = require('./swagger');
  const spec = getBaseOpenApiSpec();

  const target = process.argv[2];
  const json = JSON.stringify(spec, null, 2);

  if (target) {
    const outPath = path.resolve(__dirname, target);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`OpenAPI spec written to ${outPath}`);
    return;
  }
  process.stdout.write(json);
}

if (require.main === module) {
  main();
}
