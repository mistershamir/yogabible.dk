/**
 * MindBody Client Sync — Yoga Bible
 * Syncs MindBody clients into an email list with enrichment data.
 *
 * POST ?action=preview          — Count total MB clients
 * POST ?action=sync&listId=X    — Full sync: all clients → email list
 * POST ?action=enrich&listId=X  — Enrich contacts with purchase/service data
 * POST ?action=auto-add         — Add a single new client (called internally)
 */

const { requireAuth } = require('./shared/auth');
const { getDb } = require('./shared/firestore');
const { mbFetch, jsonResponse } = require('./shared/mb-api');
const { optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'POST only' });

  const authResult = await requireAuth(event, ['admin']);
  if (authResult.error) return authResult.error;

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    switch (action) {
      case 'preview':  return await handlePreview();
      case 'sync':     return await handleSync(params);
      case 'enrich':   return await handleEnrich(params);
      case 'auto-add': return await handleAutoAdd(event);
      default:         return jsonResponse(400, { ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error('[mb-client-sync] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

// ─── PREVIEW ──────────────────────────────────────────────────────────────────

async function handlePreview() {
  // Fetch first page just to get total count
  const data = await mbFetch('/client/clients?Limit=1&Offset=0');
  const total = (data.PaginationResponse && data.PaginationResponse.TotalResults) || 0;
  return jsonResponse(200, { ok: true, totalClients: total });
}

// ─── FULL SYNC ────────────────────────────────────────────────────────────────

async function handleSync(params) {
  const listId = params.listId;
  if (!listId) return jsonResponse(400, { ok: false, error: 'listId is required' });

  const db = getDb();

  // Verify list exists
  const listDoc = await db.collection('email_lists').doc(listId).get();
  if (!listDoc.exists) return jsonResponse(404, { ok: false, error: 'List not found' });

  // Mark list as MindBody-synced
  await db.collection('email_lists').doc(listId).update({
    source: 'mindbody',
    mb_auto_sync: true,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  // Paginate all clients from MindBody
  const allClients = [];
  let offset = 0;
  const limit = 200;
  let hasMore = true;

  while (hasMore) {
    const data = await mbFetch(`/client/clients?Limit=${limit}&Offset=${offset}`);
    const batch = data.Clients || [];
    allClients.push(...batch);

    const pagination = data.PaginationResponse || {};
    const totalResults = pagination.TotalResults || 0;
    offset += limit;

    if (batch.length < limit || offset >= totalResults) hasMore = false;
    if (offset >= 10000) hasMore = false; // Safety cap
  }

  // Get existing contacts in this list (for dedup)
  const existingSnap = await db.collection('email_list_contacts')
    .where('list_id', '==', listId)
    .select('email', 'mb_client_id')
    .get();
  const existingByEmail = new Map();
  const existingByMbId = new Map();
  existingSnap.forEach(d => {
    const data = d.data();
    if (data.email) existingByEmail.set(data.email.toLowerCase(), d.id);
    if (data.mb_client_id) existingByMbId.set(String(data.mb_client_id), d.id);
  });

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const BATCH_SIZE = 400;

  // Process in batches for Firestore writes
  for (let i = 0; i < allClients.length; i += BATCH_SIZE) {
    const chunk = allClients.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const client of chunk) {
      const email = (client.Email || '').toLowerCase().trim();
      if (!email || !email.includes('@')) { skipped++; continue; }

      const contactData = {
        email,
        first_name: client.FirstName || '',
        last_name: client.LastName || '',
        mb_client_id: client.Id,
        mb_active: client.Active || false,
        mb_status: client.Status || '',
        mb_membership: (client.MembershipIcon && client.MembershipIcon.Name) || null,
        mb_phone: client.MobilePhone || client.HomePhone || '',
        mb_created_at: client.CreationDate || null,
        mb_synced_at: new Date().toISOString()
      };

      // Check if contact already exists (by MB ID or email)
      const existingDocId = existingByMbId.get(String(client.Id)) || existingByEmail.get(email);

      if (existingDocId) {
        // Update existing contact
        batch.update(db.collection('email_list_contacts').doc(existingDocId), contactData);
        updated++;
      } else {
        // Create new contact
        const ref = db.collection('email_list_contacts').doc();
        batch.set(ref, {
          list_id: listId,
          ...contactData,
          tags: ['mindbody'],
          status: 'active',
          created_at: new Date().toISOString(),
          engagement: {
            emails_sent: 0, emails_opened: 0, emails_clicked: 0,
            last_sent_at: null, last_opened_at: null, last_clicked_at: null
          }
        });
        imported++;
      }
    }

    await batch.commit();
  }

  // Update list contact count
  const newSnap = await db.collection('email_list_contacts')
    .where('list_id', '==', listId)
    .select()
    .get();
  await db.collection('email_lists').doc(listId).update({
    contact_count: newSnap.size,
    updated_at: new Date().toISOString()
  });

  return jsonResponse(200, {
    ok: true,
    totalMbClients: allClients.length,
    imported,
    updated,
    skipped
  });
}

// ─── ENRICH ───────────────────────────────────────────────────────────────────

async function handleEnrich(params) {
  const listId = params.listId;
  if (!listId) return jsonResponse(400, { ok: false, error: 'listId is required' });

  const db = getDb();

  // Get all contacts with MB client IDs
  const contactSnap = await db.collection('email_list_contacts')
    .where('list_id', '==', listId)
    .get();

  const contacts = [];
  contactSnap.forEach(d => {
    const data = d.data();
    if (data.mb_client_id) contacts.push({ docId: d.id, ...data });
  });

  if (contacts.length === 0) {
    return jsonResponse(200, { ok: true, enriched: 0, message: 'No MindBody contacts to enrich' });
  }

  // Fetch all sales from last 2 years (paginated)
  const salesByClient = await fetchAllSales();

  // Enrich contacts in batches
  let enriched = 0;
  let errors = 0;
  const BATCH_SIZE = 10;

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const chunk = contacts.slice(i, i + BATCH_SIZE);

    // Fetch services + contracts in parallel for this batch
    const enrichPromises = chunk.map(async (contact) => {
      try {
        const clientId = contact.mb_client_id;

        // Fetch services + contracts in parallel
        const [servicesData, contractsData] = await Promise.all([
          mbFetch(`/client/clientservices?ClientId=${clientId}&CrossRegionalLookup=false&Limit=200`)
            .catch(() => ({ ClientServices: [] })),
          mbFetch(`/client/clientcontracts?ClientId=${clientId}`)
            .catch(() => ({ Contracts: [] }))
        ]);

        const now = new Date();

        // Active services
        const services = (servicesData.ClientServices || []).filter(s => {
          if (s.Returned) return false;
          const active = s.ActiveDate ? new Date(s.ActiveDate) <= now : true;
          const notExpired = !s.ExpirationDate || new Date(s.ExpirationDate) >= now;
          return active && notExpired;
        }).map(s => ({
          name: s.Name,
          remaining: s.Remaining,
          expirationDate: s.ExpirationDate,
          program: s.Program ? s.Program.Name : null
        }));

        // Active contracts (memberships)
        const contracts = (contractsData.Contracts || []).filter(c => {
          const started = c.StartDate ? new Date(c.StartDate) <= now : true;
          const notEnded = !c.EndDate || new Date(c.EndDate) >= now;
          return started && notEnded;
        }).map(c => ({
          name: c.ContractName || c.Name,
          startDate: c.StartDate,
          endDate: c.EndDate,
          autopayStatus: c.AutopayStatus,
          autopayAmount: c.AutopayAmount,
          isAutoRenewing: c.IsAutoRenewing
        }));

        // Purchase summary from pre-fetched sales
        const clientSales = salesByClient.get(String(clientId)) || [];
        const totalSpend = clientSales.reduce((sum, s) => {
          const items = s.PurchasedItems || s.Items || [];
          return sum + items.reduce((is, item) => is + (item.TotalAmount || item.AmountPaid || item.Price || 0), 0);
        }, 0);
        const lastPurchase = clientSales.length > 0
          ? clientSales.sort((a, b) => new Date(b.SaleDateTime || b.SaleDate) - new Date(a.SaleDateTime || a.SaleDate))[0]
          : null;

        // Purchase type breakdown
        const purchaseTypes = {};
        clientSales.forEach(s => {
          const items = s.PurchasedItems || s.Items || [];
          items.forEach(item => {
            const name = item.Description || item.Name || 'Unknown';
            purchaseTypes[name] = (purchaseTypes[name] || 0) + 1;
          });
        });

        return {
          docId: contact.docId,
          mb_data: {
            total_spend: Math.round(totalSpend * 100) / 100,
            purchase_count: clientSales.length,
            last_purchase_date: lastPurchase ? (lastPurchase.SaleDateTime || lastPurchase.SaleDate) : null,
            purchase_types: purchaseTypes,
            active_services: services,
            active_contracts: contracts,
            has_active_membership: contracts.length > 0,
            has_active_pass: services.length > 0,
            enriched_at: new Date().toISOString()
          }
        };
      } catch (err) {
        console.error(`[mb-client-sync] Enrich error for client ${contact.mb_client_id}:`, err.message);
        return null;
      }
    });

    const results = await Promise.all(enrichPromises);

    // Write enrichment data to Firestore
    const batch = db.batch();
    for (const result of results) {
      if (result) {
        batch.update(db.collection('email_list_contacts').doc(result.docId), {
          mb_data: result.mb_data,
          mb_synced_at: new Date().toISOString()
        });
        enriched++;
      } else {
        errors++;
      }
    }
    await batch.commit();
  }

  return jsonResponse(200, { ok: true, enriched, errors, total: contacts.length });
}

// Fetch all sales from the last 2 years, grouped by client ID
async function fetchAllSales() {
  const salesByClient = new Map();
  const endDate = new Date().toISOString().substring(0, 10);
  const startDate = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

  let offset = 0;
  const limit = 200;
  let hasMore = true;

  while (hasMore) {
    try {
      const data = await mbFetch(
        `/sale/sales?StartSaleDateTime=${startDate}T00:00:00&EndSaleDateTime=${endDate}T23:59:59&Limit=${limit}&Offset=${offset}`
      );
      const batch = data.Sales || [];

      for (const sale of batch) {
        const clientId = String(sale.ClientId || sale.RecipientClientId || '');
        if (!clientId) continue;

        if (!salesByClient.has(clientId)) salesByClient.set(clientId, []);
        salesByClient.get(clientId).push(sale);

        // Also index by RecipientClientId if different
        const recipientId = String(sale.RecipientClientId || '');
        if (recipientId && recipientId !== clientId) {
          if (!salesByClient.has(recipientId)) salesByClient.set(recipientId, []);
          salesByClient.get(recipientId).push(sale);
        }
      }

      const pagination = data.PaginationResponse || {};
      const totalResults = pagination.TotalResults || 0;
      offset += limit;

      if (batch.length < limit || offset >= totalResults) hasMore = false;
      if (offset >= 5000) hasMore = false; // Safety cap
    } catch (err) {
      console.error('[mb-client-sync] Sales fetch error at offset', offset, err.message);
      hasMore = false;
    }
  }

  return salesByClient;
}

// ─── AUTO-ADD ─────────────────────────────────────────────────────────────────

async function handleAutoAdd(event) {
  const payload = JSON.parse(event.body || '{}');
  const { email, first_name, last_name, mb_client_id, mb_phone } = payload;
  if (!email) return jsonResponse(400, { ok: false, error: 'email is required' });

  const db = getDb();

  // Find lists with mb_auto_sync enabled
  const listSnap = await db.collection('email_lists')
    .where('mb_auto_sync', '==', true)
    .get();

  if (listSnap.empty) {
    return jsonResponse(200, { ok: true, added: 0, message: 'No auto-sync lists configured' });
  }

  let added = 0;
  const normalizedEmail = email.toLowerCase().trim();

  for (const listDoc of listSnap.docs) {
    // Check if already in this list
    const existing = await db.collection('email_list_contacts')
      .where('list_id', '==', listDoc.id)
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (!existing.empty) continue;

    // Add to list
    await db.collection('email_list_contacts').add({
      list_id: listDoc.id,
      email: normalizedEmail,
      first_name: first_name || '',
      last_name: last_name || '',
      mb_client_id: mb_client_id || null,
      mb_phone: mb_phone || '',
      mb_active: true,
      mb_synced_at: new Date().toISOString(),
      tags: ['mindbody', 'new-client'],
      status: 'active',
      created_at: new Date().toISOString(),
      engagement: {
        emails_sent: 0, emails_opened: 0, emails_clicked: 0,
        last_sent_at: null, last_opened_at: null, last_clicked_at: null
      }
    });

    // Increment list count
    await db.collection('email_lists').doc(listDoc.id).update({
      contact_count: (listDoc.data().contact_count || 0) + 1,
      updated_at: new Date().toISOString()
    });

    added++;
  }

  return jsonResponse(200, { ok: true, added });
}
