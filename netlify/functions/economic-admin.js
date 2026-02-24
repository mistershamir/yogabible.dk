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
 * POST /.netlify/functions/economic-admin  { action: "sendInvoice", draftNumber: N }
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
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    console.error(`[economic] ${method} ${path} → ${res.status}`, data);
    throw new Error(data.message || data.developerHint || `e-conomic API error ${res.status}`);
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

async function createInvoice(inv) {
  if (!inv.customerNumber) throw new Error('Customer number is required');
  if (!inv.lines || !inv.lines.length) throw new Error('At least one invoice line is required');

  const payload = {
    date: inv.date || new Date().toISOString().split('T')[0],
    currency: inv.currency || 'DKK',
    customer: { customerNumber: inv.customerNumber },
    paymentTerms: { paymentTermsNumber: inv.paymentTermsNumber || 1 },
    layout: { layoutNumber: inv.layoutNumber || 19 },
    recipient: { name: inv.recipientName || '', vatZone: { vatZoneNumber: inv.vatZoneNumber || 1 } },
    lines: inv.lines.map((line, i) => ({
      lineNumber: i + 1,
      sortKey: i + 1,
      description: line.description,
      quantity: line.quantity || 1,
      unitNetPrice: line.unitNetPrice
    }))
  };

  if (inv.recipientAddress) payload.recipient.address = inv.recipientAddress;
  if (inv.recipientCity) payload.recipient.city = inv.recipientCity;
  if (inv.recipientZip) payload.recipient.zip = inv.recipientZip;
  if (inv.dueDate) payload.dueDate = inv.dueDate;
  if (inv.notes) payload.notes = { heading: inv.notes };
  if (inv.references && inv.references.text1) {
    payload.references = { other: inv.references.text1 };
  }

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
  const draft = await ecoFetch(`/invoices/drafts/${draftNumber}`);
  return ecoFetch('/invoices/booked', 'POST', { draftInvoice: { draftInvoiceNumber: draftNumber } });
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

      default:
        return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[economic-admin] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
