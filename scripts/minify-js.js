/**
 * Post-build JS + CSS minification
 * Minifies all .js files in _site/js/ using Terser
 * and all .css files in _site/css/ using basic regex minification.
 * Run after Eleventy build: node scripts/minify-js.js
 */

const { minify } = require('terser');
const fs = require('fs');
const path = require('path');

const SITE_DIR = path.join(__dirname, '..', '_site');
const JS_DIR = path.join(SITE_DIR, 'js');
const CSS_DIR = path.join(SITE_DIR, 'css');

function minifyCSS(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')       // Remove comments
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')   // Remove spaces around selectors/props
    .replace(/;\}/g, '}')                     // Remove trailing semicolons
    .replace(/\n+/g, '')                      // Remove newlines
    .replace(/\s{2,}/g, ' ')                  // Collapse whitespace
    .trim();
}

async function run() {
  let totalSaved = 0;

  // Minify JS
  if (fs.existsSync(JS_DIR)) {
    console.log('JS minification:');
    const jsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
    for (const file of jsFiles) {
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
          console.log(`  ${file}: ${originalSize} → ${newSize} (−${((saved / originalSize) * 100).toFixed(0)}%)`);
        }
      } catch (err) {
        console.warn(`  ${file}: minification failed — ${err.message}`);
      }
    }
  }

  // Minify CSS
  if (fs.existsSync(CSS_DIR)) {
    console.log('\nCSS minification:');
    const cssFiles = fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css'));
    for (const file of cssFiles) {
      const filePath = path.join(CSS_DIR, file);
      const code = fs.readFileSync(filePath, 'utf8');
      const originalSize = Buffer.byteLength(code);
      const minified = minifyCSS(code);
      fs.writeFileSync(filePath, minified);
      const newSize = Buffer.byteLength(minified);
      const saved = originalSize - newSize;
      totalSaved += saved;
      console.log(`  ${file}: ${originalSize} → ${newSize} (−${((saved / originalSize) * 100).toFixed(0)}%)`);
    }
  }

  console.log(`\nTotal saved: ${(totalSaved / 1024).toFixed(1)} KB`);
}

run();
