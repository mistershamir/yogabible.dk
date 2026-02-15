#!/bin/sh
# Build script for Hot Yoga Copenhagen member area
# Copies public/ to dist/ and injects Firebase env vars

set -e

# Install root dependencies so Netlify function bundler can resolve
# packages (googleapis etc.) used by ../netlify/functions/
cd .. && npm install --production && cd hot-yoga-cph

# Copy static files to dist
rm -rf dist
cp -r public dist

# Inject Firebase config from Netlify environment variables
# firebase-auth.js (profile pages)
sed -i "s|__FIREBASE_API_KEY__|${FIREBASE_API_KEY}|g" dist/js/firebase-auth.js
sed -i "s|__FIREBASE_AUTH_DOMAIN__|${FIREBASE_AUTH_DOMAIN}|g" dist/js/firebase-auth.js
sed -i "s|__FIREBASE_PROJECT_ID__|${FIREBASE_PROJECT_ID}|g" dist/js/firebase-auth.js
sed -i "s|__FIREBASE_STORAGE_BUCKET__|${FIREBASE_STORAGE_BUCKET}|g" dist/js/firebase-auth.js
sed -i "s|__FIREBASE_MESSAGING_SENDER_ID__|${FIREBASE_MESSAGING_SENDER_ID}|g" dist/js/firebase-auth.js
sed -i "s|__FIREBASE_APP_ID__|${FIREBASE_APP_ID}|g" dist/js/firebase-auth.js

# checkout-embed.js (Framer embed script — served cross-origin)
sed -i "s|__FIREBASE_API_KEY__|${FIREBASE_API_KEY}|g" dist/js/checkout-embed.js
sed -i "s|__FIREBASE_AUTH_DOMAIN__|${FIREBASE_AUTH_DOMAIN}|g" dist/js/checkout-embed.js
sed -i "s|__FIREBASE_PROJECT_ID__|${FIREBASE_PROJECT_ID}|g" dist/js/checkout-embed.js
sed -i "s|__FIREBASE_STORAGE_BUCKET__|${FIREBASE_STORAGE_BUCKET}|g" dist/js/checkout-embed.js
sed -i "s|__FIREBASE_MESSAGING_SENDER_ID__|${FIREBASE_MESSAGING_SENDER_ID}|g" dist/js/checkout-embed.js
sed -i "s|__FIREBASE_APP_ID__|${FIREBASE_APP_ID}|g" dist/js/checkout-embed.js

echo "Build complete — Firebase config injected into firebase-auth.js + checkout-embed.js"
