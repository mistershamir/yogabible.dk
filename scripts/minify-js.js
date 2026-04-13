/**
 * Post-build JS + CSS + HTML minification
 * Minifies all .js files in _site/js/ using Terser,
 * all .css files in _site/css/ using cssnano (PostCSS),
 * and all .html files in _site/ using html-minifier-terser.
 * Run after Eleventy build: node scripts/minify-js.js
 */

const { minify } = require('terser');
const fs = require('fs');
const path = require('path');
let htmlMinifier;
try { htmlMinifier = require('html-minifier-terser'); } catch (e) { /* optional */ }
let postcss, cssnano;
try { postcss = require('postcss'); cssnano = require('cssnano'); } catch (e) { /* optional */ }

const SITE_DIR = path.join(__dirname, '..', '_site');
const JS_DIR = path.join(SITE_DIR, 'js');
const CSS_DIR = path.join(SITE_DIR, 'css');

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

  // Minify CSS with cssnano
  if (fs.existsSync(CSS_DIR)) {
    console.log('\nCSS minification (cssnano):');
    const cssFiles = fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css'));
    if (postcss && cssnano) {
      const processor = postcss([cssnano({ preset: 'default' })]);
      for (const file of cssFiles) {
        const filePath = path.join(CSS_DIR, file);
        const code = fs.readFileSync(filePath, 'utf8');
        const originalSize = Buffer.byteLength(code);
        try {
          const result = await processor.process(code, { from: filePath, to: filePath });
          fs.writeFileSync(filePath, result.css);
          const newSize = Buffer.byteLength(result.css);
          const saved = originalSize - newSize;
          totalSaved += saved;
          console.log(`  ${file}: ${originalSize} → ${newSize} (−${((saved / originalSize) * 100).toFixed(0)}%)`);
        } catch (err) {
          console.warn(`  ${file}: cssnano failed — ${err.message}`);
        }
      }
    } else {
      console.log('  skipped (cssnano not installed)');
    }
  }

  // Minify HTML
  if (htmlMinifier) {
    console.log('\nHTML minification:');
    const htmlFiles = findHTMLFiles(SITE_DIR);
    for (const filePath of htmlFiles) {
      const html = fs.readFileSync(filePath, 'utf8');
      const originalSize = Buffer.byteLength(html);
      try {
        const minified = await htmlMinifier.minify(html, {
          collapseWhitespace: true,
          removeComments: true,
          minifyCSS: true,
          minifyJS: true,
          removeRedundantAttributes: true,
          removeEmptyAttributes: true,
          removeScriptTypeAttributes: true,
          removeStyleLinkTypeAttributes: true
        });
        fs.writeFileSync(filePath, minified);
        const newSize = Buffer.byteLength(minified);
        const saved = originalSize - newSize;
        totalSaved += saved;
        if (saved > 1024) {
          const relPath = path.relative(SITE_DIR, filePath);
          console.log(`  ${relPath}: ${originalSize} → ${newSize} (−${((saved / originalSize) * 100).toFixed(0)}%)`);
        }
      } catch (err) {
        // Skip files that fail to minify
      }
    }
  } else {
    console.log('\nHTML minification: skipped (html-minifier-terser not installed)');
  }

  console.log(`\nTotal saved: ${(totalSaved / 1024).toFixed(1)} KB`);
}

function findHTMLFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findHTMLFiles(fullPath, files);
    } else if (entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }
  return files;
}

run();
