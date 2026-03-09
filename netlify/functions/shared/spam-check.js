/**
 * Spam Protection Utilities — Yoga Bible
 * Reusable server-side checks for all public form endpoints.
 *
 * Three layers of defence:
 *  1. Honeypot   — invisible field that only bots fill in
 *  2. Timing     — forms submitted in < 4s are bots; > 2h are replays
 *  3. Duplicate  — same email cannot submit to the same collection twice
 *                  within the rate-limit window
 */

const MIN_FILL_MS  = 4000;          // < 4 s → bot
const MAX_FILL_MS  = 2 * 3600000;   // > 2 h → stale / replay

/**
 * Returns true if a honeypot field was filled (i.e. the request is spam).
 * Pass the raw string value of the hidden honeypot input.
 */
function isHoneypotTriggered(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns true if the form was filled too quickly or the token is stale.
 * @param {string|number} formOpenedAt  – Unix ms timestamp set when the modal opened
 */
function isTooFastOrStale(formOpenedAt) {
  if (!formOpenedAt) return false; // missing = legacy client, skip check
  const opened = Number(formOpenedAt);
  if (!opened || isNaN(opened)) return false;
  const elapsed = Date.now() - opened;
  return elapsed < MIN_FILL_MS || elapsed > MAX_FILL_MS;
}

/**
 * Returns true if the same email has already submitted to this Firestore
 * collection within the given window (default: 24 hours).
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} collectionName   e.g. 'careers' or 'appointments'
 * @param {string} emailField       Firestore field name for the email, e.g. 'email' or 'client_email'
 * @param {string} email            The submitter's email address
 * @param {number} windowHours      How far back to look (default 24)
 */
async function isDuplicateSubmission(db, collectionName, emailField, email, windowHours = 24) {
  try {
    const since = new Date(Date.now() - windowHours * 3600000);
    const snap = await db.collection(collectionName)
      .where(emailField, '==', email.toLowerCase().trim())
      .where('created_at', '>=', since)
      .limit(1)
      .get();
    return !snap.empty;
  } catch (err) {
    // If the check itself fails (e.g. index not ready) let the request through
    console.warn('[spam-check] Duplicate check failed (non-blocking):', err.message);
    return false;
  }
}

/**
 * Run all three checks and return a rejection reason string, or null if clean.
 *
 * Options:
 *   honeypotValue   {string}  – value of the honeypot field (if any)
 *   formOpenedAt    {string|number} – timestamp when form was opened
 *   db              {Firestore} – Firestore instance (required for duplicate check)
 *   collection      {string}  – collection to query
 *   emailField      {string}  – field name for email in that collection
 *   email           {string}  – submitter email
 *   windowHours     {number}  – rate-limit window (default 24)
 */
async function runSpamChecks({
  honeypotValue,
  formOpenedAt,
  db,
  collection,
  emailField,
  email,
  windowHours = 24
} = {}) {
  if (isHoneypotTriggered(honeypotValue)) {
    return 'honeypot';
  }

  if (isTooFastOrStale(formOpenedAt)) {
    return 'timing';
  }

  if (db && collection && emailField && email) {
    const dup = await isDuplicateSubmission(db, collection, emailField, email, windowHours);
    if (dup) return 'duplicate';
  }

  return null; // clean
}

module.exports = { isHoneypotTriggered, isTooFastOrStale, isDuplicateSubmission, runSpamChecks };
