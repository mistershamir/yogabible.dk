/**
 * Netlify Function: POST /.netlify/functions/seed-trainee-materials
 *
 * One-time seed to populate the Firestore 'documents' collection
 * with the 200-hour Triangle Method trainee materials (hosted on Google Drive).
 *
 * - Idempotent: uses set({ merge: false }) with fixed doc IDs — safe to run again
 * - Admin only: requires a valid Firebase admin token
 *
 * Usage:
 *   curl -X POST https://yogabible.dk/.netlify/functions/seed-trainee-materials \
 *     -H "Authorization: Bearer <firebase-id-token>"
 */

const { getDb } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const MATERIALS = [
  {
    id: 'vinyasa-yoga-student-manual',
    title_da: 'Vinyasa Yoga Student Manual',
    title_en: 'Vinyasa Yoga Student Manual',
    description_da: 'Komplet studiemanual til Vinyasa Yoga på dit uddannelsesprogram',
    description_en: 'Complete student manual for Vinyasa Yoga on your training program',
    fileUrl: 'https://drive.google.com/file/d/1K_JMO9ZgIBqnFKS7urdbRHBpzZrSwLHO/view',
    category: 'manual',
    order: 1,
    requiredPermissions: ['materials:200h', 'method:triangle'],
    program: '200h',
    method: 'triangle'
  },
  {
    id: 'yin-yoga-student-manual',
    title_da: 'Yin Yoga Student Manual',
    title_en: 'Yin Yoga Student Manual',
    description_da: 'Komplet studiemanual til Yin Yoga på dit uddannelsesprogram',
    description_en: 'Complete student manual for Yin Yoga on your training program',
    fileUrl: 'https://drive.google.com/file/d/1YYoQozCqpA0VQNg5FR_JQbiZ1orw6dg1/view',
    category: 'manual',
    order: 2,
    requiredPermissions: ['materials:200h', 'method:triangle'],
    program: '200h',
    method: 'triangle'
  },
  {
    id: 'yoga-anatomy-student-manual',
    title_da: 'Yoga Anatomi Student Manual',
    title_en: 'Yoga Anatomy Student Manual',
    description_da: 'Den opdaterede version af anatomimanualen til dit uddannelsesprogram',
    description_en: 'The updated anatomy manual for your training program',
    fileUrl: 'https://drive.google.com/file/d/17givFRMNaLE_iNgRmsuoRz4yd_fMgG2M/view',
    category: 'manual',
    order: 3,
    requiredPermissions: ['materials:200h', 'method:triangle'],
    program: '200h',
    method: 'triangle'
  },
  {
    id: 'yoga-philosophy-student-manual',
    title_da: 'Yoga Philosophy Student Manual',
    title_en: 'Yoga Philosophy Student Manual',
    description_da: 'Studiemanual i yogafilosofi (kun på engelsk)',
    description_en: 'Student manual covering the philosophical foundations of yoga',
    fileUrl: 'https://drive.google.com/file/d/1llp1X1h5Zl_sQSGv5ehTkvDtaPWCZX4f/view',
    category: 'manual',
    order: 4,
    requiredPermissions: ['materials:200h', 'method:triangle'],
    program: '200h',
    method: 'triangle'
  },
  {
    id: 'hatha-signature-sequence-bikram',
    title_da: 'Hatha Yoga Signature Sequence (Bikram Variation)',
    title_en: 'Hatha Yoga Signature Sequence (Bikram Variation)',
    description_da: 'Den klassiske Bikram variation af Hatha Yoga signature sekvensen',
    description_en: 'The classic Bikram variation of the Hatha Yoga signature sequence',
    fileUrl: 'https://drive.google.com/file/d/1zyIc3RHTjpzKtSRy5y48IWANNNWenNmC/view',
    category: 'reference',
    order: 5,
    requiredPermissions: ['materials:200h', 'method:triangle'],
    program: '200h',
    method: 'triangle'
  },
  {
    id: 'yoga-anatomy-student-manual-old',
    title_da: 'Yoga Anatomi Student Manual (Gammel Version)',
    title_en: 'Yoga Anatomy Student Manual (Old Version)',
    description_da: 'Den originale version af anatomimanualen — bevaret som reference',
    description_en: 'The original anatomy manual — kept for reference',
    fileUrl: 'https://drive.google.com/file/d/1mMbcxwlh_Z2IRrNxPCDg7mTlft3ocIx-/view',
    category: 'reference',
    order: 6,
    requiredPermissions: ['materials:200h', 'method:triangle'],
    program: '200h',
    method: 'triangle'
  }
];

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'POST only' });

  var user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  var db = getDb();
  var results = [];

  for (var mat of MATERIALS) {
    var docId = mat.id;
    var data = Object.assign({}, mat);
    delete data.id;
    data.createdAt = new Date();
    data.updatedAt = new Date();

    await db.collection('documents').doc(docId).set(data);
    results.push({ id: docId, ok: true });
    console.log('[seed-trainee-materials] Seeded:', docId);
  }

  return jsonResponse(200, {
    ok: true,
    seeded: results.length,
    documents: results
  });
};
