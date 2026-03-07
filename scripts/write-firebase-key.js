/**
 * Build-time script: writes FIREBASE_PRIVATE_KEY as a JS module
 * so esbuild bundles it into each Netlify Function automatically.
 *
 * This allows scoping FIREBASE_PRIVATE_KEY to "Builds" only in Netlify,
 * keeping it out of the Lambda env vars and under the 4KB limit.
 */

const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'shared', 'firebase-key-data.js');

const key = process.env.FIREBASE_PRIVATE_KEY;

if (key) {
  const resolved = key.replace(/\\n/g, '\n');
  // Write as a CommonJS module so esbuild picks it up via require()
  const content = `// Auto-generated at build time — do NOT commit\nmodule.exports = ${JSON.stringify(resolved)};\n`;
  fs.writeFileSync(KEY_FILE, content, 'utf8');
  console.log('[write-firebase-key] Wrote key module to', KEY_FILE);
} else {
  console.warn('[write-firebase-key] FIREBASE_PRIVATE_KEY not set — skipping');
}
