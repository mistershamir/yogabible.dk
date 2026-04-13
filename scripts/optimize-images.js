/**
 * Post-build image optimization.
 * Processes all HTML files in _site/ to:
 *   1. Add decoding="async" to all <img> tags (Fix 9)
 *   2. Add Bunny CDN ?width= optimization params to unoptimized CDN images (Fix 8)
 *   3. Add srcset with responsive widths for CDN images (Fix 10)
 *
 * Run after Eleventy build + minification:
 *   node scripts/optimize-images.js
 */

const fs = require('fs');
const path = require('path');

const SITE_DIR = path.join(__dirname, '..', '_site');
const BUNNY_CDN = 'https://yogabible.b-cdn.net';

function findHTMLFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) findHTMLFiles(fullPath, files);
    else if (entry.name.endsWith('.html')) files.push(fullPath);
  }
  return files;
}

function run() {
  console.log('Image optimization:');
  const htmlFiles = findHTMLFiles(SITE_DIR);
  let decodingAdded = 0;
  let srcsetAdded = 0;
  let filesModified = 0;

  for (const file of htmlFiles) {
    let html = fs.readFileSync(file, 'utf8');
    let modified = false;

    // ── Fix 9: Add decoding="async" to <img> tags that lack it ──
    // Skip images with fetchpriority="high" (hero/LCP images)
    html = html.replace(/<img\b([^>]*?)>/g, function(match, attrs) {
      if (attrs.includes('decoding=')) return match;
      if (attrs.includes('fetchpriority="high"')) return match;
      decodingAdded++;
      modified = true;
      return '<img decoding="async"' + attrs + '>';
    });

    // ── Fix 8 + 10: Bunny CDN optimization params + srcset ──
    // Match <img> with Bunny CDN src that has NO query params and NO srcset
    html = html.replace(/<img\b([^>]*?)src="(https:\/\/yogabible\.b-cdn\.net\/[^"?]+)"([^>]*?)>/g, function(match, before, src, after) {
      var allAttrs = before + after;
      // Skip if already has srcset or is an SVG
      if (allAttrs.includes('srcset=')) return match;
      if (src.endsWith('.svg')) return match;

      // Determine base width from width attribute or default
      var widthMatch = allAttrs.match(/\bwidth="(\d+)"/);
      var baseWidth = widthMatch ? parseInt(widthMatch[1]) : 800;

      // Add ?width= optimization param to src
      var optimizedSrc = src + '?width=' + baseWidth;

      // Generate srcset with responsive widths
      var widths = [400, 800, 1200].filter(function(w) { return w <= Math.max(baseWidth * 2, 1200); });
      var srcset = widths.map(function(w) { return src + '?width=' + w + ' ' + w + 'w'; }).join(', ');

      srcsetAdded++;
      modified = true;
      return '<img' + before + 'src="' + optimizedSrc + '" srcset="' + srcset + '" sizes="(max-width:768px) 100vw, 50vw"' + after + '>';
    });

    if (modified) {
      fs.writeFileSync(file, html);
      filesModified++;
    }
  }

  console.log('  decoding="async" added to ' + decodingAdded + ' images');
  console.log('  srcset + Bunny optimization added to ' + srcsetAdded + ' CDN images');
  console.log('  Modified ' + filesModified + ' HTML files');
}

run();
