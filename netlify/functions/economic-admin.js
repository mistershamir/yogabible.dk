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
const { sendRawEmail } = require('./shared/email-service');

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
  const [paymentTerms, layouts, customerGroups, vatZones, products] = await Promise.all([
    ecoFetch('/payment-terms?pagesize=100'),
    ecoFetch('/layouts?pagesize=100'),
    ecoFetch('/customer-groups?pagesize=100'),
    ecoFetch('/vat-zones?pagesize=100'),
    ecoFetch('/products?pagesize=100')
  ]);
  return {
    paymentTerms: paymentTerms.collection || [],
    layouts: layouts.collection || [],
    customerGroups: customerGroups.collection || [],
    vatZones: vatZones.collection || [],
    products: products.collection || []
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

async function getCustomer(customerNumber) {
  return ecoFetch(`/customers/${customerNumber}`);
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

  // Add lines (product is required by e-conomic when quantity/unitNetPrice are set)
  payload.lines = inv.lines.map((line, i) => {
    const l = {
      lineNumber: i + 1,
      sortKey: i + 1,
      description: line.description,
      quantity: line.quantity || 1,
      unitNetPrice: line.unitNetPrice
    };
    if (inv.productNumber) {
      l.product = { productNumber: String(inv.productNumber) };
    }
    return l;
  });

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
  console.log('[economic] Fetching booking instructions for draft #' + draftNumber);
  const instructions = await ecoFetch(`/invoices/drafts/${draftNumber}/templates/booking-instructions`);

  // Remove read-only / metadata fields that e-conomic rejects on POST
  // (same pattern as createInvoice's template cleanup)
  if (instructions) {
    delete instructions.self;
    delete instructions.metaData;
    delete instructions.templates;
    delete instructions.pdf;
  }

  console.log('[economic] Booking draft #' + draftNumber + ', payload keys:', instructions ? Object.keys(instructions).join(', ') : 'null');
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

// ─── Invoice PDF ──────────────────────────────────────────────────

/**
 * Get PDF for a booked invoice. Downloads from e-conomic and returns
 * as base64 so the client can create a blob download (the e-conomic
 * download URL requires server-side auth or may expire quickly).
 */
async function getInvoicePdf(bookedNumber) {
  const pdfInfo = await ecoFetch(`/invoices/booked/${bookedNumber}/pdf`);
  if (!pdfInfo.download) throw new Error('Could not get PDF download URL from e-conomic');

  // Ensure download URL is absolute
  let downloadUrl = pdfInfo.download;
  if (!downloadUrl.startsWith('http')) downloadUrl = BASE + downloadUrl;

  console.log('[economic] Downloading PDF for invoice #' + bookedNumber, 'from', downloadUrl.substring(0, 80));

  // Download with auth headers (no Content-Type — this is a binary download, not JSON)
  const dlHeaders = {
    'X-AppSecretToken': process.env.ECONOMIC_APP_SECRET || '',
    'X-AgreementGrantToken': process.env.ECONOMIC_AGREEMENT_TOKEN || ''
  };

  let pdfRes = await fetch(downloadUrl, { headers: dlHeaders });
  if (!pdfRes.ok) {
    // Retry without auth in case it's a pre-signed URL
    console.log('[economic] PDF download with auth failed (' + pdfRes.status + '), retrying without auth');
    pdfRes = await fetch(downloadUrl);
  }
  if (!pdfRes.ok) throw new Error('PDF download failed: ' + pdfRes.status);

  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  console.log('[economic] PDF downloaded, size:', pdfBuffer.length, 'bytes');

  return {
    base64: pdfBuffer.toString('base64'),
    filename: 'Faktura-' + bookedNumber + '.pdf',
    size: pdfBuffer.length
  };
}

// ─── Send Invoice by Email ────────────────────────────────────────

async function sendInvoiceEmail({ bookedNumber, recipientEmail }) {
  if (!bookedNumber) throw new Error('bookedNumber is required');
  if (!recipientEmail) throw new Error('recipientEmail is required');

  // 1. Fetch invoice details AND PDF in parallel (saves ~3-5s vs sequential)
  console.log('[economic] Fetching invoice + PDF for #' + bookedNumber + ', email to', recipientEmail);
  const [invoice, pdfData] = await Promise.all([
    ecoFetch(`/invoices/booked/${bookedNumber}`),
    getInvoicePdf(bookedNumber)
  ]);
  const pdfBuffer = Buffer.from(pdfData.base64, 'base64');

  // 3. Build email
  const invNum = invoice.bookedInvoiceNumber || bookedNumber;
  const custName = (invoice.recipient && invoice.recipient.name) || '';
  const total = invoice.grossAmount || invoice.netAmount || 0;
  const dueDate = invoice.dueDate || '';
  const notesText = (invoice.notes && invoice.notes.heading) || '';

  const orange = '#f75c03';
  const subject = `Faktura #${invNum} fra Yoga Bible`;

  let html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';
  html += `<p>Kære ${custName || 'kunde'},</p>`;
  html += `<p>Hermed sendes faktura <strong>#${invNum}</strong> fra Yoga Bible.</p>`;
  html += '<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:400px;">';
  html += `<tr><td style="padding:6px 16px 6px 0;color:#666;">Fakturanummer:</td><td style="padding:6px 0;font-weight:bold;">#${invNum}</td></tr>`;
  html += `<tr><td style="padding:6px 16px 6px 0;color:#666;">Beløb:</td><td style="padding:6px 0;font-weight:bold;">${total.toLocaleString('da-DK')} DKK</td></tr>`;
  if (dueDate) {
    html += `<tr><td style="padding:6px 16px 6px 0;color:#666;">Forfaldsdato:</td><td style="padding:6px 0;">${dueDate}</td></tr>`;
  }
  html += '</table>';
  if (notesText) {
    html += `<div style="margin:16px 0;padding:12px;background:#FFFCF9;border-left:3px solid ${orange};border-radius:4px;font-size:14px;color:#555;">${notesText}</div>`;
  }
  html += '<p>Fakturaen er vedhæftet som PDF.</p>';
  html += '<p>Har du spørgsmål, er du velkommen til at svare på denne email.</p>';
  // Signature
  html += '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #EBE7E3;font-size:15px;line-height:1.55;">';
  html += '<div>Kærlig hilsen,</div>';
  html += '<div><strong>Yoga Bible</strong></div>';
  html += `<div><a href="https://www.yogabible.dk" style="color:${orange};text-decoration:none;">www.yogabible.dk</a></div>`;
  html += `<div><a href="tel:+4553881209" style="color:${orange};text-decoration:none;">+45 53 88 12 09</a></div>`;
  html += '</div>';
  html += '</div>';

  const text = `Kære ${custName || 'kunde'},\n\nHermed sendes faktura #${invNum} fra Yoga Bible.\n\nBeløb: ${total} DKK\n${dueDate ? 'Forfaldsdato: ' + dueDate + '\n' : ''}${notesText ? '\n' + notesText + '\n' : ''}\nFakturaen er vedhæftet som PDF.\n\nHar du spørgsmål, er du velkommen til at svare på denne email.\n\nKærlig hilsen,\nYoga Bible\nwww.yogabible.dk\n+45 53 88 12 09`;

  // 4. Send email with PDF attachment
  console.log('[economic] Sending invoice email to', recipientEmail, '(PDF size:', pdfBuffer.length, 'bytes)');
  const result = await sendRawEmail({
    to: recipientEmail,
    subject,
    html,
    text,
    attachments: [{
      filename: `Faktura-${invNum}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
  });

  console.log('[economic] Invoice email sent to', recipientEmail, 'messageId:', result.messageId);
  return { sent: true, messageId: result.messageId, invoiceNumber: invNum };
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

      case 'getCustomer':
        if (!body.customerNumber) return jsonResponse(400, { ok: false, error: 'customerNumber required' });
        return jsonResponse(200, { ok: true, data: await getCustomer(body.customerNumber) });

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

      case 'getInvoicePdf':
        if (!body.bookedNumber) return jsonResponse(400, { ok: false, error: 'bookedNumber required' });
        return jsonResponse(200, { ok: true, data: await getInvoicePdf(body.bookedNumber) });

      case 'sendInvoice':
        if (!body.bookedNumber) return jsonResponse(400, { ok: false, error: 'bookedNumber required' });
        if (!body.email) return jsonResponse(400, { ok: false, error: 'email required' });
        return jsonResponse(200, { ok: true, data: await sendInvoiceEmail({ bookedNumber: body.bookedNumber, recipientEmail: body.email }) });

      default:
        return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[economic-admin] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
