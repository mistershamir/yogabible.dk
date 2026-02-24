/**
 * e-conomic Admin API — Yoga Bible
 * Proxies e-conomic REST API calls for the admin billing panel.
 * Tokens stay server-side for security.
 *
 * POST /.netlify/functions/economic-admin  { action: "settings" }
 * POST /.netlify/functions/economic-admin  { action: "searchCustomers", query: "..." }
 * POST /.netlify/functions/economic-admin  { action: "createCustomer", customer: {...} }
 * POST /.netlify/functions/economic-admin  { action: "createInvoice", invoice: {...} }
 * POST /.netlify/functions/economic-admin  { action: "listDrafts" }
 * POST /.netlify/functions/economic-admin  { action: "getDraft", draftNumber: N }
 * POST /.netlify/functions/economic-admin  { action: "bookInvoice", draftNumber: N }
 * POST /.netlify/functions/economic-admin  { action: "listBooked", page: N }
 * POST /.netlify/functions/economic-admin  { action: "getBooked", bookedNumber: N }
 */

const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const BASE = 'https://restapi.e-conomic.com';

function ecoHeaders() {
  return {
    'X-AppSecretToken': process.env.ECONOMIC_APP_SECRET || '',
    'X-AgreementGrantToken': process.env.ECONOMIC_AGREEMENT_TOKEN || '',
    'Content-Type': 'application/json'
  };
}

async function ecoFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: ecoHeaders() };
  if (body) opts.body = JSON.stringify(body);
  console.log(`[economic] ${method} ${path}`, body ? JSON.stringify(body).substring(0, 500) : '');
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const hint = data.developerHint || data.message || '';
    const errors = data.errors ? JSON.stringify(data.errors) : '';
    console.error(`[economic] ${method} ${path} → ${res.status}`, JSON.stringify(data).substring(0, 1000));
    throw new Error(`e-conomic ${res.status}: ${hint}${errors ? ' | ' + errors : ''}`);
  }
  return data;
}

// ─── Actions ───────────────────────────────────────────────────────

async function getSettings() {
  const [paymentTerms, layouts, customerGroups, vatZones] = await Promise.all([
    ecoFetch('/payment-terms?pagesize=100'),
    ecoFetch('/layouts?pagesize=100'),
    ecoFetch('/customer-groups?pagesize=100'),
    ecoFetch('/vat-zones?pagesize=100')
  ]);
  return {
    paymentTerms: paymentTerms.collection || [],
    layouts: layouts.collection || [],
    customerGroups: customerGroups.collection || [],
    vatZones: vatZones.collection || []
  };
}

async function searchCustomers(query) {
  const encoded = encodeURIComponent(query);
  const data = await ecoFetch(
    `/customers?pagesize=20&filter=name$like:${encoded}$or:email$like:${encoded}`
  );
  return data.collection || [];
}

async function createCustomer(c) {
  if (!c.name) throw new Error('Customer name is required');
  const payload = {
    name: c.name,
    currency: c.currency || 'DKK',
    customerGroup: { customerGroupNumber: c.customerGroupNumber || 1 },
    vatZone: { vatZoneNumber: c.vatZoneNumber || 1 },
    paymentTerms: { paymentTermsNumber: c.paymentTermsNumber || 1 }
  };
  if (c.email) payload.email = c.email;
  if (c.address) payload.address = c.address;
  if (c.city) payload.city = c.city;
  if (c.zip) payload.zip = c.zip;
  if (c.phone) payload.telephoneAndFaxNumber = c.phone;
  if (c.mobilePhone) payload.mobilePhone = c.mobilePhone;
  if (c.country) payload.country = c.country;
  if (c.corporateIdentificationNumber) payload.corporateIdentificationNumber = c.corporateIdentificationNumber;
  return ecoFetch('/customers', 'POST', payload);
}

/**
 * Create draft invoice using the customer's template (correct defaults).
 * 1. GET /customers/:num/templates/invoice → template with layout, payment terms, vat
 * 2. Merge our lines + overrides into the template
 * 3. POST /invoices/drafts
 */
async function createInvoice(inv) {
  if (!inv.customerNumber) throw new Error('Customer number is required');
  if (!inv.lines || !inv.lines.length) throw new Error('At least one invoice line is required');

  // Step 1: Fetch customer's invoice template (has correct layout, paymentTerms, vatZone)
  console.log('[economic] Fetching invoice template for customer', inv.customerNumber);
  const template = await ecoFetch(`/customers/${inv.customerNumber}/templates/invoice`);

  // Step 2: Build payload from template + our data
  const payload = { ...template };

  // Override date
  payload.date = inv.date || new Date().toISOString().split('T')[0];
  if (inv.dueDate) payload.dueDate = inv.dueDate;
  if (inv.currency) payload.currency = inv.currency;

  // Override payment terms if explicitly set
  if (inv.paymentTermsNumber) {
    payload.paymentTerms = { paymentTermsNumber: inv.paymentTermsNumber };
  }

  // Override layout if explicitly set
  if (inv.layoutNumber) {
    payload.layout = { layoutNumber: inv.layoutNumber };
  }

  // Set recipient name
  if (inv.recipientName && payload.recipient) {
    payload.recipient.name = inv.recipientName;
  }

  // Add lines
  payload.lines = inv.lines.map((line, i) => ({
    lineNumber: i + 1,
    sortKey: i + 1,
    description: line.description,
    quantity: line.quantity || 1,
    unitNetPrice: line.unitNetPrice
  }));

  // Notes
  if (inv.notes) {
    payload.notes = payload.notes || {};
    payload.notes.heading = inv.notes;
  }

  // References
  if (inv.references && inv.references.text1) {
    payload.references = payload.references || {};
    payload.references.other = inv.references.text1;
  }

  // Clean up template-only fields that shouldn't be POSTed
  delete payload.self;
  delete payload.templates;
  delete payload.pdf;

  console.log('[economic] Creating draft invoice, payload keys:', Object.keys(payload).join(', '));
  return ecoFetch('/invoices/drafts', 'POST', payload);
}

async function listDrafts(params) {
  const page = params.page || 0;
  const pageSize = params.pageSize || 25;
  const data = await ecoFetch(`/invoices/drafts?pagesize=${pageSize}&skippages=${page}&sort=-draftInvoiceNumber`);
  return {
    drafts: data.collection || [],
    pagination: data.pagination || {}
  };
}

async function getDraft(draftNumber) {
  return ecoFetch(`/invoices/drafts/${draftNumber}`);
}

async function bookInvoice(draftNumber) {
  // Get booking instructions first (required by e-conomic)
  const instructions = await ecoFetch(`/invoices/drafts/${draftNumber}/templates/booking-instructions`);
  return ecoFetch('/invoices/booked', 'POST', instructions);
}

// ─── Payment Status (Booked Invoices) ─────────────────────────────

async function listBooked(params) {
  const page = params.page || 0;
  const pageSize = params.pageSize || 25;
  const data = await ecoFetch(`/invoices/booked?pagesize=${pageSize}&skippages=${page}&sort=-bookedInvoiceNumber`);
  return {
    invoices: data.collection || [],
    pagination: data.pagination || {}
  };
}

async function getBooked(bookedNumber) {
  return ecoFetch(`/invoices/booked/${bookedNumber}`);
}

// ─── Handler ───────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'POST only' });

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  if (!process.env.ECONOMIC_APP_SECRET || !process.env.ECONOMIC_AGREEMENT_TOKEN) {
    return jsonResponse(500, { ok: false, error: 'e-conomic API tokens not configured. Set ECONOMIC_APP_SECRET and ECONOMIC_AGREEMENT_TOKEN environment variables.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON' });
  }

  const { action } = body;

  try {
    switch (action) {
      case 'settings':
        return jsonResponse(200, { ok: true, data: await getSettings() });

      case 'searchCustomers':
        return jsonResponse(200, { ok: true, data: await searchCustomers(body.query || '') });

      case 'createCustomer':
        return jsonResponse(201, { ok: true, data: await createCustomer(body.customer || {}) });

      case 'createInvoice':
        return jsonResponse(201, { ok: true, data: await createInvoice(body.invoice || {}) });

      case 'listDrafts':
        return jsonResponse(200, { ok: true, data: await listDrafts(body) });

      case 'getDraft':
        if (!body.draftNumber) return jsonResponse(400, { ok: false, error: 'draftNumber required' });
        return jsonResponse(200, { ok: true, data: await getDraft(body.draftNumber) });

      case 'bookInvoice':
        if (!body.draftNumber) return jsonResponse(400, { ok: false, error: 'draftNumber required' });
        return jsonResponse(200, { ok: true, data: await bookInvoice(body.draftNumber) });

      case 'listBooked':
        return jsonResponse(200, { ok: true, data: await listBooked(body) });

      case 'getBooked':
        if (!body.bookedNumber) return jsonResponse(400, { ok: false, error: 'bookedNumber required' });
        return jsonResponse(200, { ok: true, data: await getBooked(body.bookedNumber) });

      default:
        return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[economic-admin] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
