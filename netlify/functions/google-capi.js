/**
 * Netlify Function: POST /.netlify/functions/google-capi
 * Server-side relay for Google Ads Enhanced Conversions.
 *
 * Stores conversion events in Firestore for:
 *   1. Server-side attribution tracking (admin dashboard)
 *   2. Future Google Ads API offline conversion uploads
 *
 * POST body:
 *   conversion_action (string) — "purchase", "lead", etc.
 *   transaction_id (string)    — Deduplication ID
 *   value (number)             — Conversion value
 *   currency (string)          — Currency code (default "DKK")
 *   conversion_time (string)   — ISO timestamp
 *   page_url (string)          — Page where conversion occurred
 *   hashed_email (string)      — SHA-256 hashed email (optional)
 */

const { getFirestore } = require('./shared/firestore');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  const {
    conversion_action,
    transaction_id,
    value = 0,
    currency = 'DKK',
    conversion_time,
    page_url = '',
    hashed_email = ''
  } = body;

  if (!conversion_action) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'conversion_action is required' })
    };
  }

  // Store in Firestore for admin dashboard + future Google Ads API uploads
  try {
    const db = getFirestore();
    const conversionDoc = {
      conversion_action,
      transaction_id: transaction_id || '',
      value: parseFloat(value) || 0,
      currency,
      conversion_time: conversion_time || new Date().toISOString(),
      page_url,
      hashed_email,
      client_ip: (event.headers['x-forwarded-for'] || event.headers['x-nf-client-connection-ip'] || '').split(',')[0].trim(),
      user_agent: event.headers['user-agent'] || '',
      platform: 'google',
      created_at: new Date().toISOString()
    };

    await db.collection('ad_conversions').add(conversionDoc);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: true, stored: true })
    };
  } catch (err) {
    console.error('Google CAPI storage error:', err.message);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: true, stored: false, error: 'Storage error' })
    };
  }
};
