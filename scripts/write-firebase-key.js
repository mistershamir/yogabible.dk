/**
 * Build-time script: writes FIREBASE_PRIVATE_KEY env var to a file
 * so Netlify Functions can read it from disk instead of from env vars.
 *
 * This allows scoping FIREBASE_PRIVATE_KEY to "Builds" only in Netlify,
 * keeping it out of the Lambda env vars and under the 4KB limit.
 */

const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, '..', 'netlify', 'functions', 'shared', 'firebase-key.pem');

const key = process.env.FIREBASE_PRIVATE_KEY;

if (key) {
  fs.writeFileSync(KEY_FILE, key.replace(/\\n/g, '\n'), 'utf8');
  console.log('[write-firebase-key] Wrote private key to', KEY_FILE);
} else {
  console.warn('[write-firebase-key] FIREBASE_PRIVATE_KEY not set — skipping');
}
