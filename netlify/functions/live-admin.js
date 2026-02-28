/**
 * Netlify Function: /.netlify/functions/live-admin
 * CRUD for live-schedule Firestore collection + MindBody class import.
 *
 * Admin-only actions (require auth + admin role):
 *   GET  ?action=list          — List all scheduled live events
 *   GET  ?action=get&id=X      — Get single event
 *   GET  ?action=mb-classes    — Fetch MB classes for import
 *   POST ?action=create        — Create new live event
 *   POST ?action=update        — Update existing event
 *   POST ?action=delete        — Delete event
 *
 * Public actions (optional auth for permission filtering):
 *   GET  ?action=schedule      — Upcoming events (filtered by user permissions)
 *   GET  ?action=recordings    — Past recordings (requires recordings permission)
 */

const { requireAuth, optionalAuth } = require('./shared/auth');
const { getCollection, getDoc, addDoc, updateDoc, deleteDoc } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { mbFetch } = require('./shared/mb-api');

const COLLECTION = 'live-schedule';

const ALLOWED_FIELDS = [
  'source', 'mbClassId', 'mbClassName', 'mbProgramId', 'mbSessionTypeId',
  'title_da', 'title_en', 'description_da', 'description_en',
  'instructor', 'startDateTime', 'endDateTime', 'duration',
  'muxPlaybackId', 'muxStreamKey', 'recordingPlaybackId',
  'status', 'recurrence', 'access'
];

function sanitize(body) {
  var clean = {};
  for (var i = 0; i < ALLOWED_FIELDS.length; i++) {
    var key = ALLOWED_FIELDS[i];
    if (body[key] !== undefined) clean[key] = body[key];
  }
  return clean;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var params = event.queryStringParameters || {};
  var action = params.action || '';

  try {
    // ── Public endpoints ──
    if (action === 'schedule') return handleSchedule(event);
    if (action === 'recordings') return handleRecordings(event);

    // ── Admin endpoints ──
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
      return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }

    var user = await requireAuth(event, ['admin']);
    if (user.error) return user.error;

    switch (action) {
      case 'list': return handleList(params);
      case 'get': return handleGet(params);
      case 'mb-classes': return handleMbClasses(params);
      case 'create': return handleCreate(event, user);
      case 'update': return handleUpdate(event, user);
      case 'delete': return handleDelete(event, user);
      default:
        return jsonResponse(400, { ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('[live-admin]', err);
    return jsonResponse(err.status || 500, { ok: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// Admin: List all events
// ═══════════════════════════════════════════════════════
async function handleList(params) {
  var opts = { orderBy: 'startDateTime', orderDir: 'asc' };
  var conditions = [];

  if (params.status) {
    conditions.push({ field: 'status', op: '==', value: params.status });
  }

  var items;
  if (conditions.length) {
    const { queryDocs } = require('./shared/firestore');
    items = await queryDocs(COLLECTION, conditions, opts);
  } else {
    items = await getCollection(COLLECTION, opts);
  }

  return jsonResponse(200, { ok: true, items: items });
}

// ═══════════════════════════════════════════════════════
// Admin: Get single event
// ═══════════════════════════════════════════════════════
async function handleGet(params) {
  if (!params.id) return jsonResponse(400, { ok: false, error: 'Missing id' });
  var doc = await getDoc(COLLECTION, params.id);
  if (!doc) return jsonResponse(404, { ok: false, error: 'Not found' });
  return jsonResponse(200, { ok: true, item: doc });
}

// ═══════════════════════════════════════════════════════
// Admin: Fetch MB classes for import picker
// ═══════════════════════════════════════════════════════
async function handleMbClasses(params) {
  var now = new Date();
  var startDate = params.startDate || now.toISOString().split('T')[0];
  var endDate = params.endDate || new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0];

  var qs = {
    StartDateTime: startDate,
    EndDateTime: endDate,
    Limit: '200'
  };

  var queryString = new URLSearchParams(qs).toString();
  var data = await mbFetch('/class/classes?' + queryString);

  var classes = (data.Classes || []).map(function (cls) {
    return {
      id: cls.Id,
      name: cls.ClassDescription ? cls.ClassDescription.Name : cls.Name || 'Class',
      description: cls.ClassDescription ? cls.ClassDescription.Description : '',
      startDateTime: cls.StartDateTime,
      endDateTime: cls.EndDateTime,
      instructor: cls.Staff ? cls.Staff.Name : 'TBA',
      programId: cls.ClassDescription && cls.ClassDescription.Program ? cls.ClassDescription.Program.Id : null,
      programName: cls.ClassDescription && cls.ClassDescription.Program ? cls.ClassDescription.Program.Name : '',
      sessionTypeId: cls.ClassDescription && cls.ClassDescription.SessionType ? cls.ClassDescription.SessionType.Id : null,
      sessionTypeName: cls.ClassDescription && cls.ClassDescription.SessionType ? cls.ClassDescription.SessionType.Name : ''
    };
  });

  // Allow filtering by programId / sessionTypeId
  if (params.programId) {
    var pid = parseInt(params.programId, 10);
    classes = classes.filter(function (c) { return c.programId === pid; });
  }
  if (params.sessionTypeId) {
    var sid = parseInt(params.sessionTypeId, 10);
    classes = classes.filter(function (c) { return c.sessionTypeId === sid; });
  }

  return jsonResponse(200, { ok: true, classes: classes });
}

// ═══════════════════════════════════════════════════════
// Admin: Create event
// ═══════════════════════════════════════════════════════
async function handleCreate(event, user) {
  var body = JSON.parse(event.body || '{}');
  var data = sanitize(body);

  if (!data.title_da && !data.title_en) {
    return jsonResponse(400, { ok: false, error: 'Title required' });
  }
  if (!data.startDateTime) {
    return jsonResponse(400, { ok: false, error: 'Start date/time required' });
  }

  data.status = data.status || 'scheduled';
  data.source = data.source || 'manual';
  data.created_by = user.email;
  data.updated_by = user.email;

  // Default access if not provided
  if (!data.access) {
    data.access = { roles: ['trainee', 'teacher', 'admin'], permissions: ['live-streaming'] };
  }

  var id = await addDoc(COLLECTION, data);

  // If recurring, generate future occurrences
  if (data.recurrence && data.recurrence.type !== 'none') {
    await generateRecurrences(data, id, user);
  }

  return jsonResponse(201, { ok: true, id: id });
}

// ═══════════════════════════════════════════════════════
// Admin: Update event
// ═══════════════════════════════════════════════════════
async function handleUpdate(event, user) {
  var body = JSON.parse(event.body || '{}');
  if (!body.id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  var existing = await getDoc(COLLECTION, body.id);
  if (!existing) return jsonResponse(404, { ok: false, error: 'Not found' });

  var data = sanitize(body);
  data.updated_by = user.email;

  await updateDoc(COLLECTION, body.id, data);
  return jsonResponse(200, { ok: true });
}

// ═══════════════════════════════════════════════════════
// Admin: Delete event
// ═══════════════════════════════════════════════════════
async function handleDelete(event, user) {
  var body = JSON.parse(event.body || '{}');
  if (!body.id) return jsonResponse(400, { ok: false, error: 'Missing id' });

  var existing = await getDoc(COLLECTION, body.id);
  if (!existing) return jsonResponse(404, { ok: false, error: 'Not found' });

  await deleteDoc(COLLECTION, body.id);
  console.log('[live-admin] Deleted', body.id, 'by', user.email);
  return jsonResponse(200, { ok: true });
}

// ═══════════════════════════════════════════════════════
// Public: Upcoming schedule (permission-filtered)
// ═══════════════════════════════════════════════════════
async function handleSchedule(event) {
  var user = await optionalAuth(event);

  var now = new Date().toISOString();
  const { queryDocs } = require('./shared/firestore');
  var items = await queryDocs(COLLECTION,
    [{ field: 'status', op: 'in', value: ['scheduled', 'live'] }],
    { orderBy: 'startDateTime', orderDir: 'asc' }
  );

  // Filter to future events or currently live
  items = items.filter(function (item) {
    return item.status === 'live' || item.startDateTime >= now;
  });

  // If user authenticated, filter by their permissions
  if (user) {
    var userPerms = getUserPermissions(user.role);
    items = items.filter(function (item) {
      return hasAccess(item.access, user.role, userPerms);
    });
  }

  return jsonResponse(200, { ok: true, items: items });
}

// ═══════════════════════════════════════════════════════
// Public: Past recordings (auth + recordings permission)
// ═══════════════════════════════════════════════════════
async function handleRecordings(event) {
  var user = await optionalAuth(event);
  if (!user) {
    return jsonResponse(401, { ok: false, error: 'Authentication required' });
  }

  var userPerms = getUserPermissions(user.role);
  if (userPerms.indexOf('recordings') === -1 && user.role !== 'admin') {
    return jsonResponse(403, { ok: false, error: 'Recordings permission required' });
  }

  const { queryDocs } = require('./shared/firestore');
  var items = await queryDocs(COLLECTION,
    [{ field: 'status', op: '==', value: 'ended' }],
    { orderBy: 'startDateTime', orderDir: 'desc', limit: 50 }
  );

  // Only return items with a recording
  items = items.filter(function (item) {
    return !!item.recordingPlaybackId;
  });

  // Filter by permissions
  items = items.filter(function (item) {
    return hasAccess(item.access, user.role, userPerms);
  });

  return jsonResponse(200, { ok: true, items: items });
}

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

var ROLE_PERMISSIONS = {
  member: ['gated-content'],
  trainee: ['gated-content', 'live-streaming', 'recordings'],
  student: ['gated-content'],
  teacher: ['gated-content', 'live-streaming', 'recordings'],
  marketing: ['gated-content', 'admin:content', 'lead:manage'],
  admin: ['gated-content', 'live-streaming', 'recordings', 'admin:content', 'admin:courses', 'admin:users', 'lead:manage']
};

function getUserPermissions(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.member;
}

function hasAccess(access, role, userPerms) {
  if (!access) return true; // no restriction
  if (role === 'admin') return true;

  // Check roles
  if (access.roles && access.roles.length > 0) {
    if (access.roles.indexOf(role) !== -1) return true;
  }

  // Check permissions
  if (access.permissions && access.permissions.length > 0) {
    for (var i = 0; i < access.permissions.length; i++) {
      if (userPerms.indexOf(access.permissions[i]) !== -1) return true;
    }
  }

  // If both roles and permissions are specified but neither matched
  return false;
}

async function generateRecurrences(template, parentId, user) {
  var type = template.recurrence.type;
  var intervalWeeks = type === 'weekly' ? 1 : type === 'biweekly' ? 2 : type === 'every3weeks' ? 3 : 4;
  var endDate = template.recurrence.endDate ? new Date(template.recurrence.endDate) : null;

  // Default to 3 months if no end date
  if (!endDate) {
    endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 3);
  }

  var start = new Date(template.startDateTime);
  var end = template.endDateTime ? new Date(template.endDateTime) : null;
  var durationMs = end ? end.getTime() - start.getTime() : 3600000; // 1h default

  var occurrences = [];
  var current = new Date(start.getTime() + intervalWeeks * 7 * 86400000);

  while (current <= endDate && occurrences.length < 52) {
    var occEnd = new Date(current.getTime() + durationMs);
    occurrences.push({
      source: template.source,
      title_da: template.title_da,
      title_en: template.title_en,
      description_da: template.description_da || '',
      description_en: template.description_en || '',
      instructor: template.instructor || '',
      startDateTime: current.toISOString(),
      endDateTime: occEnd.toISOString(),
      status: 'scheduled',
      access: template.access,
      muxPlaybackId: template.muxPlaybackId || null,
      recurrence: { type: type, parentId: parentId },
      created_by: user.email,
      updated_by: user.email
    });
    current = new Date(current.getTime() + intervalWeeks * 7 * 86400000);
  }

  for (var i = 0; i < occurrences.length; i++) {
    await addDoc(COLLECTION, occurrences[i]);
  }

  console.log('[live-admin] Generated', occurrences.length, 'recurrences for', parentId);
}
