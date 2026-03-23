#!/usr/bin/env node
/**
 * Generate Bunny CDN manifest — maps extensionless paths to paths with extensions.
 *
 * This script lists ALL files in Bunny Storage and creates a lookup map so the
 * Eleventy build can resolve Cloudinary-style paths (no extension) to actual
 * Bunny Storage paths (with extension).
 *
 * Usage:
 *   node scripts/generate-bunny-manifest.js
 *
 * Output:
 *   src/_data/bunnyManifest.json
 *
 * After generating, commit the manifest. The .eleventy.js cloudimg/cloudvid
 * filters will use it to serve from Bunny CDN instead of falling back to Cloudinary.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || 'yogabible';
const BUNNY_STORAGE_KEY = process.env.BUNNY_STORAGE_API_KEY || '0bdbbefa-32a1-476f-a2d39a5a8b81-37be-4e73';
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const OUTPUT_FILE = path.join(__dirname, '..', 'src', '_data', 'bunnyManifest.json');

function listFolder(folderPath) {
  return new Promise((resolve, reject) => {
    const urlPath = '/' + BUNNY_STORAGE_ZONE + '/' + folderPath;
    const options = {
      hostname: BUNNY_STORAGE_HOST,
      path: urlPath,
      method: 'GET',
      headers: { 'AccessKey': BUNNY_STORAGE_KEY }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode + ' listing ' + folderPath + ': ' + data.slice(0, 200)));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON for ' + folderPath)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout listing ' + folderPath)); });
    req.end();
  });
}

async function listRecursive(folderPath) {
  const entries = await listFolder(folderPath);
  const files = [];

  for (const entry of entries) {
    if (entry.IsDirectory) {
      const subFiles = await listRecursive(folderPath + entry.ObjectName + '/');
      files.push(...subFiles);
    } else {
      // entry.Path is like /yogabible/yoga-bible-DK/brand/
      // entry.ObjectName is like eryt500.png
      // We want the path relative to storage zone root: yoga-bible-DK/brand/eryt500.png
      const relativePath = (folderPath + entry.ObjectName).replace(/^\//, '');
      files.push(relativePath);
    }
  }

  return files;
}

async function main() {
  console.log('Listing all files in Bunny Storage...\n');

  // List everything (root level and yoga-bible-DK/)
  const allFiles = await listRecursive('');

  console.log('Found ' + allFiles.length + ' files\n');

  // Build manifest: extensionless path → full path with extension
  const manifest = {};
  for (const file of allFiles) {
    // Strip extension to create the lookup key
    const ext = path.extname(file);
    if (ext) {
      const withoutExt = file.slice(0, -ext.length);
      manifest[withoutExt] = file;
    }
  }

  const keys = Object.keys(manifest);
  console.log('Manifest entries: ' + keys.length);
  console.log('Sample entries:');
  keys.slice(0, 10).forEach(k => console.log('  ' + k + ' → ' + manifest[k]));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
  console.log('\nWritten to: ' + OUTPUT_FILE);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
