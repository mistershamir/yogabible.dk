/**
 * Centralized API Version Constants
 *
 * Single source of truth for all external API versions used across the project.
 * Update versions here when upgrading — grep for the old value to catch any
 * hardcoded references that were missed.
 *
 * Last audited: 2026-03-12
 */

const API_VERSIONS = {
  // Meta / Facebook / Instagram Graph API
  // Latest: v25.0 (Feb 2026). Deprecation: ~2-year rolling schedule.
  // Docs: https://developers.facebook.com/docs/graph-api/changelog/versions/
  META_GRAPH: 'v25.0',

  // MindBody Public API
  // Latest: v6 (only REST version). No v7 announced.
  // Docs: https://developers.mindbodyonline.com/PublicDocumentation/V6
  MINDBODY: 'v6',

  // Firebase Client SDK (CDN compat)
  // Latest: 12.10.0. Compat layer is backwards-compatible.
  // Releases: https://github.com/firebase/firebase-js-sdk/releases
  FIREBASE_CLIENT: '12.10.0',

  // Google PageSpeed Insights API
  PAGESPEED: 'v5',

  // Bunny CDN (replaced Cloudinary)
  BUNNY: 'v1',

  // Anthropic API version header
  ANTHROPIC: '2023-06-01',
};

// Base URLs derived from versions
const BUNNY_CDN_HOST = process.env.BUNNY_CDN_HOST || 'yogabible.b-cdn.net';
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || 'yogabible';
const API_BASES = {
  META_GRAPH_FB: `https://graph.facebook.com/${API_VERSIONS.META_GRAPH}`,
  META_GRAPH_IG: `https://graph.instagram.com/${API_VERSIONS.META_GRAPH}`,
  MINDBODY: `https://api.mindbodyonline.com/public/${API_VERSIONS.MINDBODY}`,
  BUNNY_CDN: `https://${BUNNY_CDN_HOST}`,
  BUNNY_STORAGE: `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}`,
  GATEWAYAPI: 'https://gatewayapi.eu/rest/mtsms',
  ECONOMIC: 'https://restapi.e-conomic.com',
  MUX: 'https://api.mux.com',
  RESEND: 'https://api.resend.com',
};

module.exports = { API_VERSIONS, API_BASES };
