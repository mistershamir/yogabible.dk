/**
 * Firestore Client Helper — Yoga Bible
 * Firebase Admin SDK for server-side Firestore access from Netlify Functions.
 */

const admin = require('firebase-admin');

let initialized = false;

function initFirebase() {
  if (initialized) return;

  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY env var not set. Add your Firebase service account JSON to Netlify environment variables.');
  }

  const serviceAccount = JSON.parse(keyJson);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  initialized = true;
}

/**
 * Get Firestore database instance.
 */
function getDb() {
  initFirebase();
  return admin.firestore();
}

/**
 * Get Firebase Auth instance (for verifying tokens).
 */
function getAuth() {
  initFirebase();
  return admin.auth();
}

// =========================================================================
// Collection Helpers
// =========================================================================

/**
 * Get all documents from a collection.
 * @param {string} collectionName
 * @param {Object} [options] - { orderBy, limit, where: [{field, op, value}] }
 * @returns {Promise<Object[]>}
 */
async function getCollection(collectionName, options = {}) {
  const db = getDb();
  let query = db.collection(collectionName);

  if (options.where) {
    for (const w of options.where) {
      query = query.where(w.field, w.op, w.value);
    }
  }
  if (options.orderBy) {
    const dir = options.orderDir || 'desc';
    query = query.orderBy(options.orderBy, dir);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Get a single document by ID.
 * @param {string} collectionName
 * @param {string} docId
 * @returns {Promise<Object|null>}
 */
async function getDoc(collectionName, docId) {
  const db = getDb();
  const doc = await db.collection(collectionName).doc(docId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Add a new document to a collection.
 * @param {string} collectionName
 * @param {Object} data
 * @returns {Promise<string>} - Document ID
 */
async function addDoc(collectionName, data) {
  const db = getDb();
  const ref = await db.collection(collectionName).add({
    ...data,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}

/**
 * Update an existing document.
 * @param {string} collectionName
 * @param {string} docId
 * @param {Object} data
 */
async function updateDoc(collectionName, docId, data) {
  const db = getDb();
  await db.collection(collectionName).doc(docId).update({
    ...data,
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Delete a document.
 * @param {string} collectionName
 * @param {string} docId
 */
async function deleteDoc(collectionName, docId) {
  const db = getDb();
  await db.collection(collectionName).doc(docId).delete();
}

/**
 * Query documents with compound conditions.
 * @param {string} collectionName
 * @param {Array<{field: string, op: string, value: any}>} conditions
 * @param {Object} [options] - { orderBy, orderDir, limit }
 * @returns {Promise<Object[]>}
 */
async function queryDocs(collectionName, conditions, options = {}) {
  const db = getDb();
  let query = db.collection(collectionName);

  for (const c of conditions) {
    query = query.where(c.field, c.op, c.value);
  }
  if (options.orderBy) {
    query = query.orderBy(options.orderBy, options.orderDir || 'desc');
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Batch write multiple documents.
 * @param {Array<{collection: string, id?: string, data: Object, op: 'set'|'update'|'delete'}>} operations
 */
async function batchWrite(operations) {
  const db = getDb();
  const batch = db.batch();

  for (const op of operations) {
    const ref = op.id
      ? db.collection(op.collection).doc(op.id)
      : db.collection(op.collection).doc();

    if (op.op === 'delete') {
      batch.delete(ref);
    } else if (op.op === 'update') {
      batch.update(ref, { ...op.data, updated_at: admin.firestore.FieldValue.serverTimestamp() });
    } else {
      batch.set(ref, {
        ...op.data,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  await batch.commit();
}

/**
 * Get server timestamp value (for use in data objects).
 */
function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

/**
 * Array union (add items to array without duplicates).
 */
function arrayUnion(...items) {
  return admin.firestore.FieldValue.arrayUnion(...items);
}

module.exports = {
  initFirebase,
  getDb,
  getAuth,
  getCollection,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  queryDocs,
  batchWrite,
  serverTimestamp,
  arrayUnion
};
