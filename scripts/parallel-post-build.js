/**
 * Parallel post-build orchestrator for Netlify deploys.
 *
 * Phase 1 (parallel): minify-js + optimize-images — disjoint file sets.
 * Phase 2 (sequential): purge-css — needs finalized HTML + JS.
 * Phase 3 (sequential): critical-css — needs purged CSS.
 * Phase 4 (parallel): hash-assets + seo-validator — hash writes filenames,
 *   seo-validator only reads HTML so concurrent hashing of CSS/JS doesn't
 *   conflict with its HTML scan.
 */

const { spawn } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = __dirname;

function run(scriptName) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`✓ ${scriptName} (${elapsed}s)`);
        resolve();
      } else {
        reject(new Error(`${scriptName} exited with code ${code} after ${elapsed}s`));
      }
    });
    child.on('error', reject);
  });
}

async function parallel(scripts) {
  const label = scripts.join(' + ');
  console.log(`→ parallel: ${label}`);
  await Promise.all(scripts.map(run));
}

async function sequential(script) {
  console.log(`→ sequential: ${script}`);
  await run(script);
}

(async () => {
  const totalStart = Date.now();
  try {
    await parallel(['minify-js.js', 'optimize-images.js']);
    await sequential('purge-css.js');
    await sequential('critical-css.js');
    await parallel(['hash-assets.js', 'seo-validator.js']);
    const total = ((Date.now() - totalStart) / 1000).toFixed(1);
    console.log(`\nPost-build complete in ${total}s`);
  } catch (err) {
    console.error(`\nPost-build failed: ${err.message}`);
    process.exit(1);
  }
})();
