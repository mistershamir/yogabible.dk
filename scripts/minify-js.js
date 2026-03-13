/**
 * Post-build JS minification
 * Minifies all .js files in _site/js/ using Terser.
 * Run after Eleventy build: node scripts/minify-js.js
 */

const { minify } = require('terser');
const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', '_site', 'js');

async function run() {
  if (!fs.existsSync(JS_DIR)) {
    console.log('No _site/js/ directory found — skipping minification.');
    return;
  }

  const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  let totalSaved = 0;

  for (const file of files) {
    const filePath = path.join(JS_DIR, file);
    const code = fs.readFileSync(filePath, 'utf8');
    const originalSize = Buffer.byteLength(code);

    try {
      const result = await minify(code, {
        compress: { drop_console: false, passes: 2 },
        mangle: true,
        format: { comments: false }
      });

      if (result.code) {
        fs.writeFileSync(filePath, result.code);
        const newSize = Buffer.byteLength(result.code);
        const saved = originalSize - newSize;
        totalSaved += saved;
        const pct = ((saved / originalSize) * 100).toFixed(0);
        console.log(`  ${file}: ${originalSize} → ${newSize} (−${pct}%)`);
      }
    } catch (err) {
      console.warn(`  ${file}: minification failed — ${err.message}`);
    }
  }

  console.log(`\nTotal saved: ${(totalSaved / 1024).toFixed(1)} KB`);
}

run();
