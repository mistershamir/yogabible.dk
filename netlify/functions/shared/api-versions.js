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

  // Cloudinary API
  CLOUDINARY: 'v1_1',

  // Anthropic API version header
  ANTHROPIC: '2023-06-01',
};

// Base URLs derived from versions
// CLOUDINARY and CLOUDINARY_API are configurable via env vars for CDN migration
const CLOUDINARY_CLOUD = process.env.CLOUDINARY_CLOUD_NAME || 'ddcynsa30';
const API_BASES = {
  META_GRAPH_FB: `https://graph.facebook.com/${API_VERSIONS.META_GRAPH}`,
  META_GRAPH_IG: `https://graph.instagram.com/${API_VERSIONS.META_GRAPH}`,
  MINDBODY: `https://api.mindbodyonline.com/public/${API_VERSIONS.MINDBODY}`,
  CLOUDINARY: process.env.CLOUDINARY_BASE_URL || `https://res.cloudinary.com/${CLOUDINARY_CLOUD}`,
  CLOUDINARY_API: `https://api.cloudinary.com/${API_VERSIONS.CLOUDINARY}/${CLOUDINARY_CLOUD}`,
  GATEWAYAPI: 'https://gatewayapi.eu/rest/mtsms',
  ECONOMIC: 'https://restapi.e-conomic.com',
  MUX: 'https://api.mux.com',
  RESEND: 'https://api.resend.com',
};

module.exports = { API_VERSIONS, API_BASES };
