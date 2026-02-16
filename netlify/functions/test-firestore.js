/**
 * Temporary test endpoint to verify Firestore connection.
 * DELETE THIS after confirming it works.
 * GET /.netlify/functions/test-firestore
 */
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  try {
    const db = getDb();
    
    // Try to read the users collection (should exist from Firebase Auth)
    const usersSnap = await db.collection('users').limit(1).get();
    const userCount = usersSnap.size;
    
    // List all collections
    const collections = await db.listCollections();
    const collectionNames = collections.map(c => c.id);
    
    return jsonResponse(200, {
      ok: true,
      message: 'Firestore connected!',
      collections: collectionNames,
      users_found: userCount > 0
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      error: error.message
    });
  }
};
