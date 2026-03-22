/**
 * CSS Purge — removes unused CSS rules from built CSS files.
 * Scans all HTML and JS files in _site/ to find used class names,
 * then removes rules whose selectors reference classes not found.
 *
 * Run after Eleventy build: node scripts/purge-css.js
 *
 * Safety: preserves all :root, @font-face, @keyframes, html/body/*,
 * and any rules with dynamic class patterns (data-*, is-*, js-*).
 */

const fs = require('fs');
const path = require('path');

const SITE_DIR = path.join(__dirname, '..', '_site');

// Classes that might be added dynamically via JS — always keep
const SAFELIST_PATTERNS = [
  /^is-/,          // State classes (is-active, is-open, etc.)
  /^has-/,         // State classes
  /^js-/,          // JS hooks
  /^wf-/,          // Web font loading states
  /^active/,       // Active states
  /^open/,         // Open states
  /^show/,         // Show/hide states
  /^hide/,         // Show/hide states
  /^visible/,      // Visibility states
  /^hidden/,       // Visibility states
  /^loaded/,       // Load states
  /^loading/,      // Load states
  /^error/,        // Error states
  /^success/,      // Success states
  /^disabled/,     // Disabled states
  /^selected/,     // Selection states
  /^checked/,      // Checked states
  /^expanded/,     // Expanded states
  /^collapsed/,    // Collapsed states
];

// Always keep these selectors regardless of usage
const ALWAYS_KEEP = [
  /^:root/,
  /^@font-face/,
  /^@keyframes/,
  /^html/,
  /^body/,
  /^\*/,
  /^\[data-/,       // Data attribute selectors
  /::selection/,
  /::placeholder/,
  /:focus/,
  /::-webkit/,
  /::-moz/,
];

function findFiles(dir, extensions, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFiles(fullPath, extensions, files);
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractUsedClasses(files) {
  const classes = new Set();
  const classRegex = /(?:class(?:Name)?(?:\s*=\s*|\s*:\s*)["'`]([^"'`]*)["'`]|classList\.(?:add|remove|toggle|contains)\s*\(\s*["'`]([^"'`]*)["'`]|className\s*[+=]+\s*["'`]([^"'`]*)["'`])/g;

  // Also find classes referenced as string literals in JS (e.g., querySelector('.foo'))
  const selectorRegex = /(?:querySelector(?:All)?|getElementsByClassName|closest)\s*\(\s*["'`]\.?([a-zA-Z_][\w-]*)["'`]/g;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');

    // Extract from class attributes
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      const value = match[1] || match[2] || match[3];
      if (value) {
        value.split(/\s+/).forEach(cls => {
          if (cls) classes.add(cls);
        });
      }
    }

    // Extract from querySelector etc
    while ((match = selectorRegex.exec(content)) !== null) {
      if (match[1]) classes.add(match[1]);
    }

    // Extract from HTML class attributes (already covered above but be thorough)
    const htmlClassRegex = /class="([^"]*)"/g;
    while ((match = htmlClassRegex.exec(content)) !== null) {
      match[1].split(/\s+/).forEach(cls => {
        if (cls) classes.add(cls);
      });
    }
  }

  return classes;
}

function shouldKeepRule(selector, usedClasses) {
  // Always keep base selectors
  for (const pattern of ALWAYS_KEEP) {
    if (pattern.test(selector)) return true;
  }

  // Extract class names from selector
  const classMatches = selector.match(/\.([a-zA-Z_][\w-]*)/g);
  if (!classMatches) return true; // No classes = element selector, keep it

  // Keep if ANY class in selector is used or safelisted
  for (const classRef of classMatches) {
    const className = classRef.substring(1); // Remove the dot

    if (usedClasses.has(className)) return true;

    // Check safelist patterns
    for (const pattern of SAFELIST_PATTERNS) {
      if (pattern.test(className)) return true;
    }
  }

  return false;
}

function purgeCSS(css, usedClasses) {
  const keptRules = [];
  const removedCount = { rules: 0, bytes: 0 };
  let i = 0;

  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;

    const ruleStart = i;

    if (css[i] === '@') {
      // @-rule
      const headerEnd = css.indexOf('{', i);
      const atHeader = css.substring(i, headerEnd).trim();
      let depth = 0;
      while (i < css.length) {
        if (css[i] === '{') depth++;
        if (css[i] === '}') {
          depth--;
          if (depth === 0) { i++; break; }
        }
        i++;
      }
      const fullRule = css.substring(ruleStart, i);

      if (atHeader.startsWith('@font-face') || atHeader.startsWith('@keyframes') || atHeader.startsWith('@-webkit-keyframes')) {
        keptRules.push(fullRule);
      } else if (atHeader.startsWith('@media')) {
        // Purge inside @media
        const innerStart = fullRule.indexOf('{') + 1;
        const innerEnd = fullRule.lastIndexOf('}');
        const innerCSS = fullRule.substring(innerStart, innerEnd);
        const purgedInner = purgeInner(innerCSS, usedClasses, removedCount);
        if (purgedInner) {
          keptRules.push(atHeader + '{' + purgedInner + '}');
        }
      } else {
        keptRules.push(fullRule); // Keep other @-rules
      }
    } else {
      // Regular rule
      let depth = 0;
      while (i < css.length) {
        if (css[i] === '{') depth++;
        if (css[i] === '}') {
          depth--;
          if (depth === 0) { i++; break; }
        }
        i++;
      }
      const fullRule = css.substring(ruleStart, i);
      const selector = fullRule.substring(0, fullRule.indexOf('{')).trim();

      if (shouldKeepRule(selector, usedClasses)) {
        keptRules.push(fullRule);
      } else {
        removedCount.rules++;
        removedCount.bytes += fullRule.length;
      }
    }
  }

  return { css: keptRules.join(''), removed: removedCount };
}

function purgeInner(css, usedClasses, removedCount) {
  const rules = [];
  let i = 0;

  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;

    const ruleStart = i;
    let depth = 0;
    while (i < css.length) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
      i++;
    }
    const fullRule = css.substring(ruleStart, i);
    const selector = fullRule.substring(0, fullRule.indexOf('{')).trim();

    if (shouldKeepRule(selector, usedClasses)) {
      rules.push(fullRule);
    } else {
      removedCount.rules++;
      removedCount.bytes += fullRule.length;
    }
  }

  return rules.length > 0 ? rules.join('') : null;
}

function run() {
  console.log('CSS Purge: scanning for used classes...');

  // Find all HTML and JS files in _site
  const htmlFiles = findFiles(SITE_DIR, ['.html']);
  const jsFiles = findFiles(SITE_DIR, ['.js']);
  const allFiles = [...htmlFiles, ...jsFiles];

  const usedClasses = extractUsedClasses(allFiles);
  console.log(`CSS Purge: found ${usedClasses.size} unique class names in ${allFiles.length} files`);

  // Process each CSS file
  const cssFiles = findFiles(SITE_DIR, ['.css']);
  let totalSaved = 0;

  for (const cssFile of cssFiles) {
    const css = fs.readFileSync(cssFile, 'utf8');
    const originalSize = Buffer.byteLength(css);
    const { css: purgedCSS, removed } = purgeCSS(css, usedClasses);
    const newSize = Buffer.byteLength(purgedCSS);
    const saved = originalSize - newSize;
    totalSaved += saved;

    if (removed.rules > 0) {
      fs.writeFileSync(cssFile, purgedCSS);
      const relPath = path.relative(SITE_DIR, cssFile);
      console.log(`  ${relPath}: ${originalSize} → ${newSize} (−${((saved / originalSize) * 100).toFixed(0)}%, removed ${removed.rules} rules)`);
    }
  }

  console.log(`CSS Purge: total saved ${(totalSaved / 1024).toFixed(1)} KB`);
}

run();
