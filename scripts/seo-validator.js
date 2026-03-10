#!/usr/bin/env node
/**
 * SEO/AEO Build Validator for yogabible.dk
 * Runs after Eleventy build to catch SEO issues before deploy.
 *
 * Usage:  node scripts/seo-validator.js [--strict]
 * --strict: exit code 1 on warnings (default: exit 1 only on errors)
 */

const fs = require('fs');
const path = require('path');

const SITE_DIR = path.join(__dirname, '..', '_site');
const SITE_URL = 'https://yogabible.dk';

// Configurable thresholds
const TITLE_MAX = 60;
const TITLE_MIN = 20;
const DESC_MAX = 160;
const DESC_MIN = 80;
const CORRECT_YTT_PRICE = '23750'; // DKK, no dots
const CORRECT_YTT_PRICE_DISPLAY = '23.750';

// Pages that don't need full SEO (admin, embed, auth, etc.)
const SKIP_PATHS = [
  '/admin/', '/embed/', '/auth-action/', '/404.html',
  '/samples/', '/archive/', '/schedule-token/',
  '/assets/', '/vibroyoga-showcase/', '/vibroyogadesign/',
  '/profile/', '/member/', '/link/', '/schedule-samples/',
  '/skema/', '/course-material/'
];

const errors = [];
const warnings = [];
const info = [];

// ── Helpers ────────────────────────────────────────────────────────

function findHtmlFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findHtmlFiles(full, files);
    } else if (entry.name === 'index.html' || entry.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

function relPath(file) {
  return '/' + path.relative(SITE_DIR, file).replace(/index\.html$/, '').replace(/\\/g, '/');
}

function extract(html, regex) {
  const m = html.match(regex);
  return m ? m[1] : null;
}

function extractAll(html, regex) {
  const results = [];
  let m;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  while ((m = re.exec(html)) !== null) results.push(m[1]);
  return results;
}

// ── Checks ─────────────────────────────────────────────────────────

function checkPage(file) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = relPath(file);

  // Skip non-public pages
  if (SKIP_PATHS.some(p => rel.startsWith(p))) return;

  const lang = extract(html, /<html[^>]*lang="([^"]+)"/);
  const title = extract(html, /<title>([^<]+)<\/title>/);
  const desc = extract(html, /<meta\s+name="description"\s+content="([^"]*)"/);
  const canonical = extract(html, /<link\s+rel="canonical"\s+href="([^"]*)"/);
  const ogTitle = extract(html, /<meta\s+property="og:title"\s+content="([^"]*)"/);
  const ogDesc = extract(html, /<meta\s+property="og:description"\s+content="([^"]*)"/);
  const ogImage = extract(html, /<meta\s+property="og:image"\s+content="([^"]*)"/);
  const h1s = extractAll(html, /<h1[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/h1>/);
  const hreflang = html.includes('hreflang');

  // 1. Title
  if (!title) {
    errors.push(`${rel} — Missing <title>`);
  } else {
    const plainTitle = title.replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ');
    if (plainTitle.length > TITLE_MAX) {
      warnings.push(`${rel} — Title too long (${plainTitle.length}/${TITLE_MAX}): "${plainTitle.slice(0, 50)}..."`);
    }
    if (plainTitle.length < TITLE_MIN) {
      warnings.push(`${rel} — Title too short (${plainTitle.length}/${TITLE_MIN}): "${plainTitle}"`);
    }
  }

  // 2. Meta description
  if (!desc) {
    errors.push(`${rel} — Missing meta description`);
  } else {
    const plainDesc = desc.replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ');
    if (plainDesc.length > DESC_MAX) {
      warnings.push(`${rel} — Description too long (${plainDesc.length}/${DESC_MAX}): "${plainDesc.slice(0, 60)}..."`);
    }
    if (plainDesc.length < DESC_MIN) {
      warnings.push(`${rel} — Description too short (${plainDesc.length}/${DESC_MIN})`);
    }
  }

  // 3. Canonical
  if (!canonical) {
    warnings.push(`${rel} — Missing canonical URL`);
  } else if (!canonical.startsWith(SITE_URL)) {
    warnings.push(`${rel} — Canonical doesn't start with ${SITE_URL}: ${canonical}`);
  }

  // 4. Open Graph
  if (!ogTitle) warnings.push(`${rel} — Missing og:title`);
  if (!ogDesc) warnings.push(`${rel} — Missing og:description`);
  if (!ogImage) warnings.push(`${rel} — Missing og:image`);

  // 5. Lang attribute
  if (!lang) {
    errors.push(`${rel} — Missing lang attribute on <html>`);
  }

  // 6. H1 check
  if (h1s.length === 0) {
    warnings.push(`${rel} — No <h1> found`);
  } else if (h1s.length > 1) {
    warnings.push(`${rel} — Multiple <h1> tags (${h1s.length})`);
  }

  // 7. Structured data check (at least homepage and program pages should have it)
  const hasJsonLd = html.includes('application/ld+json');
  const isKeyPage = ['/', '/en/', '/200-hours', '/300-hours', '/om-200', '/yoga-journal'].some(p => rel.startsWith(p) || rel === p);
  if (isKeyPage && !hasJsonLd) {
    warnings.push(`${rel} — Key page missing structured data (JSON-LD)`);
  }

  // 8. Hreflang check for DA pages (should point to EN equivalent)
  const isDa = !rel.startsWith('/en/');
  if (isDa && !rel.startsWith('/admin/') && !hreflang) {
    // Only warn for pages that likely have EN equivalents
    const enEquiv = path.join(SITE_DIR, 'en', path.relative(SITE_DIR, file));
    if (fs.existsSync(enEquiv)) {
      warnings.push(`${rel} — Has EN equivalent but no hreflang tags`);
    }
  }

  // 9. Image alt text check (sample of first 20 images)
  const imgs = extractAll(html, /<img\s+([^>]*)>/);
  let missingAlt = 0;
  for (const attrs of imgs.slice(0, 20)) {
    if (!attrs.includes('alt=') || /alt=["']["']/.test(attrs)) {
      missingAlt++;
    }
  }
  if (missingAlt > 0) {
    warnings.push(`${rel} — ${missingAlt} image(s) missing or empty alt text`);
  }
}

function checkStructuredData() {
  const indexHtml = path.join(SITE_DIR, 'index.html');
  if (!fs.existsSync(indexHtml)) return;

  const html = fs.readFileSync(indexHtml, 'utf8');
  const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];

  for (const block of jsonLdBlocks) {
    const json = block.replace(/<\/?script[^>]*>/g, '');
    try {
      const data = JSON.parse(json);
      // Check for wrong price in structured data
      checkPricesInObject(data, 'homepage structured data');
    } catch (e) {
      errors.push(`Homepage — Invalid JSON-LD: ${e.message.slice(0, 80)}`);
    }
  }
}

function checkPricesInObject(obj, context) {
  if (!obj || typeof obj !== 'object') return;

  if (obj.price && String(obj.price).replace(/\./g, '') === '25500') {
    errors.push(`${context} — Wrong YTT price 25500, should be ${CORRECT_YTT_PRICE}`);
  }

  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      val.forEach(item => checkPricesInObject(item, context));
    } else if (typeof val === 'object') {
      checkPricesInObject(val, context);
    }
  }
}

function checkPriceConsistency() {
  // Check i18n JSON files for the old wrong price
  const i18nDir = path.join(__dirname, '..', 'src', '_data', 'i18n');
  if (!fs.existsSync(i18nDir)) return;

  for (const file of fs.readdirSync(i18nDir)) {
    if (!file.endsWith('.json')) continue;
    const content = fs.readFileSync(path.join(i18nDir, file), 'utf8');
    if (content.includes('25.500') || content.includes('25500')) {
      warnings.push(`src/_data/i18n/${file} — Contains old price 25.500 (should be ${CORRECT_YTT_PRICE_DISPLAY})`);
    }
  }

  // Check lead emails
  const emailFile = path.join(__dirname, '..', 'netlify', 'functions', 'shared', 'lead-emails.js');
  if (fs.existsSync(emailFile)) {
    const content = fs.readFileSync(emailFile, 'utf8');
    if (content.includes('25.500') || content.includes('25500')) {
      warnings.push(`netlify/functions/shared/lead-emails.js — Contains old price 25.500 (should be ${CORRECT_YTT_PRICE_DISPLAY})`);
    }
  }
}

function checkSitemap() {
  const sitemap = path.join(SITE_DIR, 'sitemap.xml');
  if (!fs.existsSync(sitemap)) {
    errors.push('Missing sitemap.xml');
    return;
  }

  const content = fs.readFileSync(sitemap, 'utf8');

  if (!content.includes('xhtml:link')) {
    warnings.push('sitemap.xml — No hreflang links (xhtml:link) found');
  }

  // Check for key pages in sitemap
  const keyPages = [
    '/', '/en/', '/200-hours-4-weeks-intensive-programs/',
    '/200-hours-8-weeks-semi-intensive-programs/',
    '/200-hours-18-weeks-flexible-programs/',
    '/yoga-journal/', '/yoga-glossary/'
  ];
  for (const page of keyPages) {
    if (!content.includes(SITE_URL + page)) {
      warnings.push(`sitemap.xml — Missing key page: ${page}`);
    }
  }
}

function checkRobotsTxt() {
  const robots = path.join(SITE_DIR, 'robots.txt');
  if (!fs.existsSync(robots)) {
    errors.push('Missing robots.txt');
    return;
  }

  const content = fs.readFileSync(robots, 'utf8');
  if (!content.includes('Sitemap:')) {
    warnings.push('robots.txt — Missing Sitemap directive');
  }
}

function checkHreflangPairs() {
  // Verify every DA page has an EN equivalent and vice versa
  const daPages = new Set();
  const enPages = new Set();

  const allFiles = findHtmlFiles(SITE_DIR);
  for (const file of allFiles) {
    const rel = relPath(file);
    if (SKIP_PATHS.some(p => rel.startsWith(p))) continue;
    if (rel.startsWith('/en/')) {
      enPages.add(rel.replace('/en/', '/'));
    } else {
      daPages.add(rel);
    }
  }

  let missingEn = 0;
  let missingDa = 0;
  for (const p of daPages) {
    if (!enPages.has(p) && !['/', '/404.html'].includes(p)) missingEn++;
  }
  for (const p of enPages) {
    if (!daPages.has(p)) missingDa++;
  }

  if (missingEn > 0) info.push(`${missingEn} DA page(s) without EN equivalent`);
  if (missingDa > 0) info.push(`${missingDa} EN page(s) without DA equivalent`);
}

// ── Main ───────────────────────────────────────────────────────────

function main() {
  const strict = process.argv.includes('--strict');

  console.log('\n🔍 SEO/AEO Validator — yogabible.dk\n');

  if (!fs.existsSync(SITE_DIR)) {
    console.error('❌ _site/ directory not found. Run eleventy build first.');
    process.exit(1);
  }

  const files = findHtmlFiles(SITE_DIR);
  console.log(`Scanning ${files.length} HTML files...\n`);

  // Run all checks
  files.forEach(checkPage);
  checkStructuredData();
  checkPriceConsistency();
  checkSitemap();
  checkRobotsTxt();
  checkHreflangPairs();

  // Report
  if (errors.length > 0) {
    console.log(`❌ ERRORS (${errors.length}):`);
    errors.forEach(e => console.log(`  • ${e}`));
    console.log();
  }

  if (warnings.length > 0) {
    console.log(`⚠️  WARNINGS (${warnings.length}):`);
    warnings.forEach(w => console.log(`  • ${w}`));
    console.log();
  }

  if (info.length > 0) {
    console.log(`ℹ️  INFO:`);
    info.forEach(i => console.log(`  • ${i}`));
    console.log();
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ All SEO checks passed!\n');
  } else if (errors.length === 0) {
    console.log(`✅ No errors. ${warnings.length} warning(s) to review.\n`);
  }

  // Summary
  console.log(`📊 Summary: ${files.length} pages | ${errors.length} errors | ${warnings.length} warnings`);
  console.log();

  // Exit code
  if (errors.length > 0) process.exit(1);
  if (strict && warnings.length > 0) process.exit(1);
}

main();
