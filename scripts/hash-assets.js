/**
 * Hash-based asset filenames for immutable caching.
 * Renames CSS/JS files to include content hash (e.g., main.a1b2c3d4.css)
 * and updates all references in HTML and JS files.
 *
 * Run LAST in the build pipeline (after minify, purge, critical-css):
 *   node scripts/hash-assets.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITE_DIR = path.join(__dirname, '..', '_site');

function contentHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex').slice(0, 8);
}

function findFiles(dir, extensions, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) findFiles(fullPath, extensions, files);
    else if (extensions.some(ext => entry.name.endsWith(ext))) files.push(fullPath);
  }
  return files;
}

function run() {
  console.log('Asset hashing:');

  const cssDir = path.join(SITE_DIR, 'css');
  const jsDir = path.join(SITE_DIR, 'js');
  const renames = {}; // { '/css/main.css': '/css/main.a1b2c3d4.css' }

  // Hash and rename CSS files
  if (fs.existsSync(cssDir)) {
    for (const file of fs.readdirSync(cssDir).filter(f => f.endsWith('.css'))) {
      const filePath = path.join(cssDir, file);
      const content = fs.readFileSync(filePath);
      const h = contentHash(content);
      const ext = path.extname(file);
      const base = path.basename(file, ext);
      const newName = base + '.' + h + ext;
      fs.renameSync(filePath, path.join(cssDir, newName));
      renames['/css/' + file] = '/css/' + newName;
      console.log('  /css/' + file + ' → /css/' + newName);
    }
  }

  // Hash and rename JS files
  if (fs.existsSync(jsDir)) {
    for (const file of fs.readdirSync(jsDir).filter(f => f.endsWith('.js'))) {
      const filePath = path.join(jsDir, file);
      const content = fs.readFileSync(filePath);
      const h = contentHash(content);
      const ext = path.extname(file);
      const base = path.basename(file, ext);
      const newName = base + '.' + h + ext;
      fs.renameSync(filePath, path.join(jsDir, newName));
      renames['/js/' + file] = '/js/' + newName;
      console.log('  /js/' + file + ' → /js/' + newName);
    }
  }

  // Update references in all HTML files
  const htmlFiles = findFiles(SITE_DIR, ['.html']);
  let htmlUpdated = 0;
  for (const file of htmlFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    for (const [oldPath, newPath] of Object.entries(renames)) {
      if (content.includes(oldPath)) {
        content = content.split(oldPath).join(newPath);
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(file, content);
      htmlUpdated++;
    }
  }

  // Update cross-references inside JS files (e.g., cookies.js → tracking.js)
  const hashedJsFiles = findFiles(jsDir, ['.js']);
  let jsUpdated = 0;
  for (const file of hashedJsFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    for (const [oldPath, newPath] of Object.entries(renames)) {
      if (content.includes(oldPath)) {
        content = content.split(oldPath).join(newPath);
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(file, content);
      jsUpdated++;
    }
  }

  console.log('  Updated ' + htmlUpdated + ' HTML files, ' + jsUpdated + ' JS files');
  console.log('  Total: ' + Object.keys(renames).length + ' assets hashed');
}

run();
