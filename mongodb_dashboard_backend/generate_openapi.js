const fs = require('fs');
const path = require('path');
const { getBaseOpenApiSpec } = require('./swagger');

const outputDir = path.join(__dirname, 'interfaces');
const outputPath = path.join(outputDir, 'openapi.json');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const spec = getBaseOpenApiSpec();
// Force regeneration path by clearing any prior cache if module retained it (dev runs)
if (spec && typeof spec === 'object') {
  // no-op, spec already retrieved; run write below
}

// Persist generated spec to file
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
console.log(`[openapi] Spec written to ${outputPath} with ${Object.keys(spec.paths || {}).length} paths.`);

// Note: User Analysis endpoints were removed; spec reflects remaining core routes.
