/**
 * Netlify Function: seed-trainee-materials
 *
 * GET  → returns status of each of the 6 materials (exists / missing)
 * POST → seeds only the MISSING documents (preserves existing edits)
 *
 * Admin only. Idempotent: running POST multiple times is safe.
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
    method: 'triangle',
    active: true
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
    method: 'triangle',
    active: true
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
    method: 'triangle',
    active: true
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
    method: 'triangle',
    active: true
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
    method: 'triangle',
    active: true
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
    method: 'triangle',
    active: true
  }
];

async function getStatuses(db) {
  const results = await Promise.all(
    MATERIALS.map(async (mat) => {
      const doc = await db.collection('documents').doc(mat.id).get();
      return { id: mat.id, exists: doc.exists, material: mat };
    })
  );
  return results;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const db = getDb();

  // GET → return status only (no writes)
  if (event.httpMethod === 'GET') {
    const statuses = await getStatuses(db);
    return jsonResponse(200, {
      ok: true,
      materials: statuses.map(s => ({
        id: s.id,
        title_en: s.material.title_en,
        title_da: s.material.title_da,
        category: s.material.category,
        order: s.material.order,
        requiredPermissions: s.material.requiredPermissions,
        active: s.material.active,
        exists: s.exists
      }))
    });
  }

  // POST → seed missing docs only
  if (event.httpMethod === 'POST') {
    const statuses = await getStatuses(db);
    const missing  = statuses.filter(s => !s.exists);
    const existing = statuses.filter(s => s.exists);

    for (const s of missing) {
      const data = Object.assign({}, s.material);
      delete data.id;
      data.createdAt = new Date();
      data.updatedAt = new Date();
      await db.collection('documents').doc(s.id).set(data);
      console.log('[seed-trainee-materials] Created:', s.id);
    }

    return jsonResponse(200, {
      ok: true,
      created: missing.length,
      skipped: existing.length,
      createdIds: missing.map(s => s.id),
      skippedIds: existing.map(s => s.id)
    });
  }

  return jsonResponse(405, { ok: false, error: 'GET or POST only' });
};
