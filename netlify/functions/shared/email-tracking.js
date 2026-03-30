/**
 * Email Tracking Helpers — Yoga Bible
 *
 * Injects tracking pixel + wraps links for lead-level email engagement tracking.
 * Works alongside the existing campaign-level tracking in resend-service.js.
 *
 * Usage:
 *   const { prepareTrackedEmail } = require('./shared/email-tracking');
 *   const trackedHtml = prepareTrackedEmail(html, leadId, sourceTag);
 */

const crypto = require('crypto');
const { CONFIG } = require('./config');

const TRACK_BASE = 'https://yogabible.dk/.netlify/functions/email-track';

/**
 * Inject a 1x1 tracking pixel for lead-level open tracking.
 * Uses t=open with lid (lead ID) and src (source tag like "seq:Ma2ca:3").
 */
function injectLeadTrackingPixel(html, leadId, source) {
  if (!html || !leadId) return html;
  var pixelUrl = TRACK_BASE + '?t=open&lid=' + encodeURIComponent(leadId);
  if (source) pixelUrl += '&src=' + encodeURIComponent(source);
  var pixel = '<img src="' + pixelUrl + '" width="1" height="1" style="display:none" alt="" />';
  return html + pixel;
}

/**
 * Wrap all links in email HTML through the click tracking redirect.
 * Sets a lead identification cookie on click-through for website behavior tracking.
 */
function wrapLeadLinks(html, leadId, source) {
  if (!html || !leadId) return html;
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, function (match, url) {
    // Don't wrap unsubscribe, tracking pixels, or already-wrapped links
    if (url.includes('/unsubscribe') || url.includes('/email-track') || url.includes('/email-click')) return match;
    var trackUrl = TRACK_BASE + '?t=click&lid=' + encodeURIComponent(leadId) +
      '&url=' + encodeURIComponent(url);
    if (source) trackUrl += '&src=' + encodeURIComponent(source);
    return 'href="' + trackUrl + '"';
  });
}

/**
 * Full email tracking preparation: wraps links + injects pixel.
 * Call this as the LAST step before sending (after variable substitution,
 * schedule token injection, etc.)
 *
 * @param {string} html - Email body HTML
 * @param {string} leadId - Firestore lead document ID
 * @param {string} source - Source tag for attribution (e.g., "seq:Ma2ca:3", "welcome:4w")
 * @returns {string} HTML with tracking pixel and wrapped links
 */
function prepareTrackedEmail(html, leadId, source) {
  if (!html || !leadId) return html;
  var result = wrapLeadLinks(html, leadId, source);
  result = injectLeadTrackingPixel(result, leadId, source);
  return result;
}

module.exports = { prepareTrackedEmail, injectLeadTrackingPixel, wrapLeadLinks };
