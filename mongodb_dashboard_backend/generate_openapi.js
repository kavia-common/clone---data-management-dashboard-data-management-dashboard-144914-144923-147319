const fs = require('fs');
const path = require('path');
const { getBaseOpenApiSpec } = require('./swagger');

const outputDir = path.join(__dirname, 'interfaces');
const outputPath = path.join(outputDir, 'openapi.json');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const spec = getBaseOpenApiSpec();

// Persist generated spec to file
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
console.log(`[openapi] Spec written to ${outputPath} with ${Object.keys(spec.paths || {}).length} paths.`);
