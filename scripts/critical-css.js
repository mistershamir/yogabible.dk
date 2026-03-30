/**
 * Critical CSS Inlining
 * Extracts above-the-fold CSS (header + hero) from main.css
 * and inlines it into HTML pages for faster First Contentful Paint.
 *
 * Run after Eleventy build + minification: node scripts/critical-css.js
 */

const fs = require('fs');
const path = require('path');

const SITE_DIR = path.join(__dirname, '..', '_site');
const CSS_PATH = path.join(SITE_DIR, 'css', 'main.css');

// Above-the-fold class prefixes — header, hero, buttons, fork2, core layout
const CRITICAL_PREFIXES = [
  'yb-util', 'yb-nav', 'yb-dd', 'yb-burger', 'yb-mob-flag',
  'yb-drawer', 'yb-acc', 'yb-mega',
  'yb-hero', 'yb-btn', 'yb-fork2',
  'yb-header'
];

// Also grab :root variables, @font-face, and body/html base styles
const BASE_PATTERNS = [
  /^:root\s*\{/,
  /^@font-face\s*\{/,
  /^html[\s,{]/,
  /^body[\s,{]/,
  /^\*[\s,{]/,
  /^@media.*prefers-reduced-motion/
];

function extractCriticalCSS(css) {
  // Parse CSS into rules (handling nested @media blocks)
  const criticalRules = [];
  let i = 0;

  while (i < css.length) {
    // Skip whitespace
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;

    // Find the start of a rule or @-rule
    const ruleStart = i;

    if (css[i] === '@') {
      // @-rule: find matching closing brace (handles nesting)
      const atRuleHeader = css.substring(i, css.indexOf('{', i));
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

      // Check if it's a @font-face or @media containing critical rules
      if (atRuleHeader.includes('@font-face')) {
        criticalRules.push(fullRule);
      } else if (atRuleHeader.includes('@media')) {
        // Extract critical rules inside @media
        const innerStart = fullRule.indexOf('{') + 1;
        const innerEnd = fullRule.lastIndexOf('}');
        const innerCSS = fullRule.substring(innerStart, innerEnd);
        const criticalInner = extractInnerCriticalRules(innerCSS);
        if (criticalInner) {
          criticalRules.push(atRuleHeader + '{' + criticalInner + '}');
        }
      }
    } else {
      // Regular rule: find closing brace
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

      if (isCriticalSelector(selector)) {
        criticalRules.push(fullRule);
      }
    }
  }

  return criticalRules.join('');
}

function extractInnerCriticalRules(css) {
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

    if (isCriticalSelector(selector)) {
      rules.push(fullRule);
    }
  }

  return rules.length > 0 ? rules.join('') : null;
}

function isCriticalSelector(selector) {
  // Check base patterns (html, body, :root, etc.)
  for (const pattern of BASE_PATTERNS) {
    if (pattern.test(selector)) return true;
  }

  // Check if selector contains any critical class prefix
  for (const prefix of CRITICAL_PREFIXES) {
    if (selector.includes('.' + prefix)) return true;
  }

  return false;
}

function inlineIntoHTML(htmlPath, criticalCSS) {
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Insert critical CSS as <style> before the <link rel="stylesheet" href="/css/main.css">
  // and make main.css load async
  const cssLink = html.match(/<link\s+rel="stylesheet"\s+href="\/css\/main\.css"\s*\/?>/);
  if (!cssLink) return false;

  const replacement =
    '<style>' + criticalCSS + '</style>\n' +
    '<link rel="stylesheet" href="/css/main.css" media="print" onload="this.media=\'all\'">\n' +
    '<noscript><link rel="stylesheet" href="/css/main.css"></noscript>';

  html = html.replace(cssLink[0], replacement);
  fs.writeFileSync(htmlPath, html);
  return true;
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

function run() {
  if (!fs.existsSync(CSS_PATH)) {
    console.log('Critical CSS: main.css not found, skipping');
    return;
  }

  const fullCSS = fs.readFileSync(CSS_PATH, 'utf8');
  const criticalCSS = extractCriticalCSS(fullCSS);

  console.log(`Critical CSS: extracted ${(Buffer.byteLength(criticalCSS) / 1024).toFixed(1)} KB from ${(Buffer.byteLength(fullCSS) / 1024).toFixed(1)} KB main.css`);

  // Inline into all HTML files
  const htmlFiles = findHTMLFiles(SITE_DIR);
  let count = 0;
  for (const htmlFile of htmlFiles) {
    if (inlineIntoHTML(htmlFile, criticalCSS)) {
      count++;
    }
  }

  console.log(`Critical CSS: inlined into ${count} HTML files, main.css now loads async`);
}

run();
