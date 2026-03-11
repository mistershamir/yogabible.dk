/**
 * Email Lists Endpoint — Yoga Bible
 * CRUD for email contact lists + CSV import.
 *
 * Firestore collections:
 *   email_lists           — list metadata (name, description, tags, source)
 *   email_list_contacts   — flat contacts collection with list_id reference
 *
 * POST   /.netlify/functions/email-lists                — Create list
 * POST   /.netlify/functions/email-lists?action=import  — CSV import contacts into a list
 * POST   /.netlify/functions/email-lists?action=add     — Add single contact
 * GET    /.netlify/functions/email-lists                — List all lists
 * GET    /.netlify/functions/email-lists?id=X           — Get single list + contact count
 * GET    /.netlify/functions/email-lists?id=X&contacts=1 — Get list + all contacts
 * GET    /.netlify/functions/email-lists?action=search&email=X — Search contact across all lists
 * PUT    /.netlify/functions/email-lists                — Update list metadata
 * DELETE /.netlify/functions/email-lists?id=X           — Delete list + all contacts
 * DELETE /.netlify/functions/email-lists?contactId=X    — Delete single contact
 */

const { requireAuth } = require('./shared/auth');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const authResult = await requireAuth(event, ['admin', 'marketing']);
  if (authResult.error) return authResult.error;

  const db = getDb();
  const params = event.queryStringParameters || {};

  try {
    switch (event.httpMethod) {
      case 'GET':    return await handleGet(db, params);
      case 'POST':   return await handlePost(db, event, params);
      case 'PUT':    return await handlePut(db, event);
      case 'DELETE': return await handleDelete(db, params);
      default:       return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[email-lists] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

// ─── GET ─────────────────────────────────────────────────────────────────────

async function handleGet(db, params) {
  // Search contact across all lists
  if (params.action === 'search' && params.email) {
    const email = params.email.toLowerCase().trim();
    const snap = await db.collection('email_list_contacts')
      .where('email', '==', email)
      .limit(50)
      .get();
    const results = [];
    snap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
    return jsonResponse(200, { ok: true, contacts: results });
  }

  // Single list
  if (params.id) {
    const doc = await db.collection('email_lists').doc(params.id).get();
    if (!doc.exists) return jsonResponse(404, { ok: false, error: 'List not found' });

    const list = { id: doc.id, ...doc.data() };

    if (params.contacts === '1') {
      const contactSnap = await db.collection('email_list_contacts')
        .where('list_id', '==', params.id)
        .orderBy('created_at', 'desc')
        .limit(10000)
        .get();
      list.contacts = [];
      contactSnap.forEach(d => list.contacts.push({ id: d.id, ...d.data() }));
    }

    return jsonResponse(200, { ok: true, list });
  }

  // All lists
  const snap = await db.collection('email_lists')
    .orderBy('created_at', 'desc')
    .get();
  const lists = [];
  snap.forEach(doc => lists.push({ id: doc.id, ...doc.data() }));

  return jsonResponse(200, { ok: true, lists });
}

// ─── POST ────────────────────────────────────────────────────────────────────

async function handlePost(db, event, params) {
  const payload = JSON.parse(event.body || '{}');

  // Import CSV contacts into existing list
  if (params.action === 'import') {
    return await handleImport(db, payload);
  }

  // Add single contact to a list
  if (params.action === 'add') {
    return await handleAddContact(db, payload);
  }

  // Create new list
  if (!payload.name) {
    return jsonResponse(400, { ok: false, error: 'name is required' });
  }

  const record = {
    name: payload.name,
    description: payload.description || '',
    tags: payload.tags || [],
    source: payload.source || 'manual',
    contact_count: 0,
    unsubscribed_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: event.headers['x-user-email'] || 'unknown'
  };

  const ref = await db.collection('email_lists').add(record);

  return jsonResponse(200, { ok: true, listId: ref.id, record });
}

// Import CSV data into a list
async function handleImport(db, payload) {
  const { listId, contacts } = payload;
  if (!listId) return jsonResponse(400, { ok: false, error: 'listId is required' });
  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return jsonResponse(400, { ok: false, error: 'contacts array is required' });
  }

  // Verify list exists
  const listDoc = await db.collection('email_lists').doc(listId).get();
  if (!listDoc.exists) return jsonResponse(404, { ok: false, error: 'List not found' });

  // Deduplicate against existing contacts in this list
  const existingSnap = await db.collection('email_list_contacts')
    .where('list_id', '==', listId)
    .select('email')
    .get();
  const existingEmails = new Set();
  existingSnap.forEach(d => existingEmails.add((d.data().email || '').toLowerCase()));

  let imported = 0;
  let skipped = 0;
  let invalid = 0;
  const BATCH_SIZE = 400;

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const chunk = contacts.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const contact of chunk) {
      const email = (contact.email || '').toLowerCase().trim();
      if (!email || !email.includes('@')) { invalid++; continue; }
      if (existingEmails.has(email)) { skipped++; continue; }

      existingEmails.add(email);
      const ref = db.collection('email_list_contacts').doc();
      batch.set(ref, {
        list_id: listId,
        email,
        first_name: (contact.first_name || '').trim(),
        last_name: (contact.last_name || '').trim(),
        tags: contact.tags || [],
        status: 'active',         // active | unsubscribed | bounced
        created_at: new Date().toISOString(),
        engagement: {
          emails_sent: 0,
          emails_opened: 0,
          emails_clicked: 0,
          last_sent_at: null,
          last_opened_at: null,
          last_clicked_at: null
        }
      });
      imported++;
    }

    await batch.commit();
  }

  // Update list contact count
  const currentData = listDoc.data();
  await db.collection('email_lists').doc(listId).update({
    contact_count: (currentData.contact_count || 0) + imported,
    updated_at: new Date().toISOString()
  });

  return jsonResponse(200, {
    ok: true,
    imported,
    skipped,
    invalid,
    total: contacts.length
  });
}

// Add single contact
async function handleAddContact(db, payload) {
  const { listId, email, first_name, last_name, tags } = payload;
  if (!listId || !email) return jsonResponse(400, { ok: false, error: 'listId and email are required' });

  const normalizedEmail = email.toLowerCase().trim();

  // Check for duplicate
  const existing = await db.collection('email_list_contacts')
    .where('list_id', '==', listId)
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();
  if (!existing.empty) {
    return jsonResponse(409, { ok: false, error: 'Contact already exists in this list' });
  }

  const ref = await db.collection('email_list_contacts').add({
    list_id: listId,
    email: normalizedEmail,
    first_name: (first_name || '').trim(),
    last_name: (last_name || '').trim(),
    tags: tags || [],
    status: 'active',
    created_at: new Date().toISOString(),
    engagement: {
      emails_sent: 0,
      emails_opened: 0,
      emails_clicked: 0,
      last_sent_at: null,
      last_opened_at: null,
      last_clicked_at: null
    }
  });

  // Increment list count
  const listDoc = await db.collection('email_lists').doc(listId).get();
  if (listDoc.exists) {
    await db.collection('email_lists').doc(listId).update({
      contact_count: (listDoc.data().contact_count || 0) + 1,
      updated_at: new Date().toISOString()
    });
  }

  return jsonResponse(200, { ok: true, contactId: ref.id });
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

async function handlePut(db, event) {
  const payload = JSON.parse(event.body || '{}');
  if (!payload.id) return jsonResponse(400, { ok: false, error: 'id is required' });

  const updates = { updated_at: new Date().toISOString() };
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.tags !== undefined) updates.tags = payload.tags;

  // Also allow updating a single contact
  if (payload.contactId) {
    const contactUpdates = {};
    if (payload.contact_tags !== undefined) contactUpdates.tags = payload.contact_tags;
    if (payload.contact_status !== undefined) contactUpdates.status = payload.contact_status;
    if (payload.contact_first_name !== undefined) contactUpdates.first_name = payload.contact_first_name;
    if (payload.contact_last_name !== undefined) contactUpdates.last_name = payload.contact_last_name;
    await db.collection('email_list_contacts').doc(payload.contactId).update(contactUpdates);
    return jsonResponse(200, { ok: true });
  }

  await db.collection('email_lists').doc(payload.id).update(updates);
  return jsonResponse(200, { ok: true });
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

async function handleDelete(db, params) {
  // Delete single contact
  if (params.contactId) {
    const contactDoc = await db.collection('email_list_contacts').doc(params.contactId).get();
    if (contactDoc.exists) {
      const listId = contactDoc.data().list_id;
      await db.collection('email_list_contacts').doc(params.contactId).delete();
      // Decrement count
      const listDoc = await db.collection('email_lists').doc(listId).get();
      if (listDoc.exists) {
        await db.collection('email_lists').doc(listId).update({
          contact_count: Math.max(0, (listDoc.data().contact_count || 1) - 1),
          updated_at: new Date().toISOString()
        });
      }
    }
    return jsonResponse(200, { ok: true });
  }

  // Delete entire list + all contacts
  if (!params.id) return jsonResponse(400, { ok: false, error: 'id is required' });

  // Delete contacts in batches
  const BATCH_SIZE = 400;
  let hasMore = true;
  while (hasMore) {
    const snap = await db.collection('email_list_contacts')
      .where('list_id', '==', params.id)
      .limit(BATCH_SIZE)
      .get();
    if (snap.empty) { hasMore = false; break; }
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }

  await db.collection('email_lists').doc(params.id).delete();
  return jsonResponse(200, { ok: true });
}
