/**
 * Careers Seed — Yoga Bible
 * Admin-only. POST /.netlify/functions/careers-seed?confirm=seed
 * Seeds the `careers` Firestore collection from the CSV export.
 * Skips rows where the email already exists in the collection.
 */

const { getDb } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// =============================================================================
// Cleaned from "Careers - Careers.csv"
// Test submissions by shamir@hotyogacph.dk skipped (rows 2–6, row 40).
// =============================================================================
const SEED_DATA = [
  {
    first_name: 'Meg',
    last_name: 'Conrad',
    email: 'mlynnellis@gmail.com',
    phone: '52528450',
    category: 'Mentorship & privates',
    subcategory: 'Mentorship for undervisere',
    other_topic: '',
    role: 'Mentor / privates',
    experience: '3–5 år',
    links: '',
    city_country: '',
    languages: '',
    background: '',
    message: '- Mentorship for 200hr teacher trainee graduates, covering topics such as: finding your confidence & voice, sequencing, cueing & language, holding space, working with specific populations, career path & community building, cultivating a personal practice, boundaries, ethics and challenges, navigating the changing yoga landscape, other questions/topics specific to each trainee, etc.\n\n(I could see this being offered or packaged as an extra option alongside their teacher training program, so that upon graduation they can be paired with me for additional support as they begin to step out. Likewise, it could be pitched halfway through the training for those leaning towards teaching but still feeling like they could use a little more guidance or support after.)\n\n- Private Lessons for anyone interested in a practice to support them in times of stress. So something geared around stress relief/stress management and relaxation. (This could potentially be a larger group offering and not just a private, as well.) Sessions would involve targeted gentle movement & stretching, breath work & meditation, hands on adjustments and assists.\n\nAs I said before, I could also be interested in other ideas or opportunities. The above are just two that have specifically come to my mind so far. I\'m also taking some CEUs in Yoga Anatomy, so once I\'ve completed this, I\'d love to get involved in another way specific to anatomy. And not related to yoga, but still a supportive modality for overall health & wellbeing, I am a certified holistic nutrition & health practitioner and occasionally work with clients when my schedule has allowed. But, if you\'d be interested in offering any options to people through Yoga Bible around this, that could be an option, as well.',
    page_url: 'https://en.yogabible.dk/careers',
    submitted_at: '2026-01-12T11:06:53Z',
    file_count: 0,
    file_names: '',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Mille Marie Lund',
    last_name: 'Jørgensen',
    email: 'mille0509@hotmail.com',
    phone: '4541900086',
    category: 'Administration & outreach',
    subcategory: 'Kundeservice / koordinering',
    other_topic: '',
    role: 'Administration / outreach',
    experience: '3–5 år',
    links: 'https://www.instagram.com/mille_lund1',
    city_country: 'Danmark',
    languages: 'Dansk, Engelsk',
    background: '200 timers Yoga Teacher Training – House of Om, Bali (Dec 2025)\nCertificeret yogalærer i Hatha og Vinyasa\nTræningen inkluderede pranayama, meditation, breathwork, anatomi, alignment samt hands-on adjustments\n\nInternational erfaring fra yoga- og retreatmiljøer\nUndervisning og arbejde på retreats og surf camps i Sri Lanka og Portugal, med ansvar for både undervisning, gæstekontakt, praktisk support og daglig drift\n\nStærk baggrund inden for kundeservice og reception\nErfaring med kundekontakt, administrativt arbejde, booking, koordinering og community-building i internationale og travle miljøer\n\nPædagogisk erfaring\n2 års erfaring som pædagogmedhjælper med børn og unge med særlige behov, herunder facilitering af yoga og bevægelse med fokus på tryghed, nærvær og struktur\n\nSoMe & content creation\nErfaring med Instagram og TikTok, herunder reels, video-redigering, content-planlægning og visuel formidling',
    message: 'Jeg har mulighed for at undervise i Hatha og Vinyasa yoga, med fokus på grounding, nærvær og en tryg, mindful praksis. Derudover kan jeg bidrage med kundekontakt og reception, koordinering og administrative opgaver samt content creation og SoMe-arbejde (Instagram/TikTok, reels og planlægning).',
    page_url: 'https://www.yogabible.dk/careers#yb-careers-need',
    submitted_at: '2026-01-24T12:50:49Z',
    file_count: 1,
    file_names: 'CV: CV - Mille Marie Lund Jørgensen.pdf — https://drive.google.com/file/d/1Yb5WbZbx09zIFVXqnGd7arvm-VO5afFy/view?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Vigga Rau',
    last_name: 'Ibsen',
    email: 'vigga@rau-ibsen.dk',
    phone: '4524274161',
    category: 'Yoga / Meditation Teacher',
    subcategory: 'Vinyasa, Yin, Andet workshop',
    other_topic: '',
    role: 'Underviser / modul',
    experience: '0–2 år',
    links: '',
    city_country: 'Valby',
    languages: 'Danish, English, possible Spanish',
    background: 'I am a 200h yin and vinyasa trained teacher from Senses in Sri Lanka. My teaching style depends on whether it is vinyasa or yin yoga, but common to both is a focus on pranayama. My vinyasa classes focus on strength and creating a moving meditation. Since I have many years of experience in dance, I also pay close attention to the music I choose to play for my classes, and I love watching my students flow through my flows. In my yin classes, my focus as a teacher is to guide my students into their bodies and try to let go of some of the clutter that can often fill them, while at the same time guiding them further into their stretches through physical support. With my background in dance, I generally have a big focus on transitions and flowing from one movement to another.\nI have been a regular at Hot Yoga Aarhus for the past 5 years, both in their Bikram, Vinyasa and Yin classes, before I took my yoga teacher training - and I have really been looking for a studio that offers hot yoga in a good and inclusive way, so I hope there could be a place for me with you.\n\nI am a student at the University of Copenhagen and have previously taught for, among others, the rowing team at Marietta College in Ohio, USA, as well as for young international exchange students. I am used to teaching in both Danish and English.',
    message: 'I would love to teach modules and returning classes in both yin and vinyasa where i get to hold the room for my students and develop a relationship with them.',
    page_url: 'https://en.yogabible.dk/careers',
    submitted_at: '2026-01-26T09:02:16Z',
    file_count: 2,
    file_names: 'CV: CV- Vigga Rau Ibsen.pdf — https://drive.google.com/file/d/1OT4ECQMoVk_vbuC_v5Dd287DGiIVGVdH/view?usp=drivesdk | EXTRA: Yoga teacher certificate.jpeg — https://drive.google.com/file/d/19w9MkF_aL9SX9V049v0F74DFadyI7ZLP/view?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Maren',
    last_name: 'Tinz',
    email: 'maren.tinz@gmail.com',
    phone: '4593835595',
    category: 'Yoga / Meditation Teacher',
    subcategory: 'Vinyasa, Yin, Hatha, Hot Yoga',
    other_topic: '',
    role: 'Underviser / modul',
    experience: '0–2 år',
    links: 'https://www.instagram.com/maren_moves/',
    city_country: 'København',
    languages: 'german, english, danish',
    background: '200YTT certified by Yoga Alliance and Yoga Bilble',
    message: 'I would like to teach Hatha, Vinyasa and Yin',
    page_url: 'https://en.yogabible.dk/careers',
    submitted_at: '2026-01-29T17:03:41Z',
    file_count: 1,
    file_names: 'CV: CV.docx — https://docs.google.com/document/d/1z-BytrNjDxl3H8n-D9SoERdvomP3WRmC/edit?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Astrid',
    last_name: 'Bottger',
    email: 'astridbottger123@gmail.com',
    phone: '4571340374',
    category: 'Yoga / Meditation Teacher',
    subcategory: 'Vinyasa, Yin, Ashtanga, Hatha, Hot Yoga, Meditation',
    other_topic: '',
    role: 'Lead trainer',
    experience: '0–2 år',
    links: '',
    city_country: 'DK',
    languages: 'English',
    background: 'I did my 300 hours in india and my 200 hours online',
    message: 'Hello, i would love to be part of your studio.\nIm a yoga teacher , open to teach whenever is needed\nI speak english and im from Argentina',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-02-02T17:50:56Z',
    file_count: 1,
    file_names: 'CV: Yoga teacher astrid .pdf — https://drive.google.com/file/d/1V2ZIpLeBaw3K9O1jL2XsUWLJIXbnBqzp/view?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Luna',
    last_name: 'Lundquist',
    email: 'lunalundq@gmail.com',
    phone: '28254584',
    category: 'Yoga / Meditation Teacher',
    subcategory: 'Vinyasa, Yin, Hatha, Hot Yoga, Meditation, Breathwork, Pilates, Bikram Yoga, Kids Yoga, Yoga for seniors',
    other_topic: '',
    role: 'Lead trainer',
    experience: '0–2 år',
    links: '',
    city_country: 'Copenhagen, DK',
    languages: 'Danish, English',
    background: 'I got my 200h Yoga Teacher Training from HYC in December, and have been doing private lessons since then',
    message: 'I would love to work as a yoga teacher, teaching my own classes in Yin, Vinyasa and Hatha yoga. I am doing my degree in philosophy at KU so my schedule is very flexible, as I only have classes a couple days a week. I live right by Kongens Nytorv, so am only 10 min away on my bike :)\n Hope to hear from you!',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-02-03T17:24:08Z',
    file_count: 1,
    file_names: 'CV: Luna Lundquist CV.docx — https://docs.google.com/document/d/1imk8VGHq4O4iQBTi52UyLLCz5Ikoj72n/edit?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Stefania',
    last_name: 'Oliveira',
    email: 'ste_loirinha@hotmail.com',
    phone: '34646137597',
    category: 'Yoga / Meditation Teacher',
    subcategory: 'Yin, Hatha, Hot Yoga, Meditation, Breathwork, Bikram Yoga',
    other_topic: '',
    role: 'Lead trainer',
    experience: '10+ år',
    links: 'https://www.instagram.com/stef_8614/',
    city_country: '',
    languages: 'English',
    background: 'Hot Yoga Teacher Training 200 hours\nThai Massage Certification\nMeditation Retreats:\n- 10 day silence in Nepal\n- 10 day introduction to Buddhism Nepal\n- 5 day Retreat in Terror Osel Ling Nepal with Mingyur Rinpoche\n- 10 day Retreat with teacher Alan Wallace\n- 5 day Retreat in Germany with Mingyur Rinpoche',
    message: 'Dear [Hiring Manager / Studio Team],\n\nI hope this message finds you well.\n\nI am writing to apply for a position as a yoga teacher at your studio this summer (2026). Please find my CV attached for your consideration. I would be very happy to have the opportunity to contribute to your community by offering mindful, accessible, and welcoming yoga classes. (Perhaps as a substitute during summer period).\n\nIn addition, I would like to mention that my partner is also seeking a summer job (CV attached). We are hoping to spend the summer together, and he would be very open to any type of work or support role that might be available during that period, either within your studio or in another job around the city.\n\nWe are both responsible, motivated, and respectful, and we value teamwork, reliability, and a positive working environment.\n\nThank you very much for your time and consideration. I would be happy to provide any additional information if needed and look forward to hearing from you.',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-02-07T17:30:49Z',
    file_count: 2,
    file_names: 'CV: Stefânia Oliveira - 2026.pdf — https://drive.google.com/file/d/1SKBZSjYnc4d2J3gEJCe4JmAC0eNC76Yc/view?usp=drivesdk | EXTRA: Basilio Camiña 2026.pdf — https://drive.google.com/file/d/1BLU9jX3M9FtMt4vSlImuetLzZnPfsmnm/view?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Josephine Elise',
    last_name: 'Schøyen',
    email: 'josephineschoyen@gmail.com',
    phone: '4748268285',
    category: 'Yoga / Meditation Teacher',
    subcategory: 'Vinyasa, Yin, Hot Yoga, Bikram Yoga',
    other_topic: '',
    role: 'Underviser / modul',
    experience: '6–10 år',
    links: '',
    city_country: 'Norge',
    languages: 'Norsk, dansk, engelsk',
    background: '200 tt ashtanga basert vinyasa og tin, 150tt medisinsk yoga, apprentice bikram',
    message: 'Jeg arbeider 100% for Norges største yogastudio, med noen av de mest populære timene, men jeg ønsker nye impulser, mer innsikt og tyngde. Og jeg vil flytte til København og håper jeg kan være en sterk ressurs for dere',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-02-07T20:43:32Z',
    file_count: 1,
    file_names: 'CV: Josephine Elise Schøyen CV  2.pdf — https://drive.google.com/file/d/1WpiQd-EyR626AU31YtJUPfAEvyIFO7wx/view?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Vanille',
    last_name: 'Simeon',
    email: 'vanillesimeon@hotmail.com',
    phone: '4591474753',
    category: 'Yoga / Meditation Teacher, Uddannelser (YTT), Kurser & workshops, Mentorship & privates, Administration & outreach',
    subcategory: 'Vinyasa, Yin, Meditation, Breathwork, Acro Yoga, Yoga for seniors, Lead trainer, Assistant lead trainer, Anatomi & biomekanik, Filosofi & historie, Breathwork / pranayama, Yin / restorative, Alignment & skadeforebyggelse, Andet YTT modul, Inversions, Splits & hip opening, Mobilitet & styrke, Tema-forløb (30–50 timer), Weekend intensive, Andet workshop, Privat undervisning (praksis), Mentorship for undervisere, Business / studio mentorship, Program design & sparring, Client communication, Kundeservice / koordinering, Events / community',
    other_topic: '',
    role: 'Lead trainer',
    experience: '10+ år',
    links: 'https://www.vanillesimeon.me',
    city_country: 'Denmark',
    languages: 'English, Danish, French, Spanish',
    background: 'My training includes certifications in Vinyasa and Yin Yoga, as well as studies in OsteoThai, Thai Massage, and Partner Acrobatics (AcroYoga), which have enriched my understanding of anatomy and movement. In addition, my background as a sophrology therapist and my studies in Buddhism and mindfulness shape the compassionate, mindful quality of my classes.',
    message: 'With 20+ years of personal practice and 10 years of full-time teaching, I have taught over 1000 Vinyasa, Yin, breathwork and meditation classes and led over 100 workshops in yoga studios and movement centers. I also co-facilitated several wellness, stress detox and mindfulness transformative retreats in the South of France.\n\nIn the last 3 years, another long-standing dream of mine came true. I created and led Yin and Vinyasa yoga teacher trainings, as well as Somatic Yoga & Trauma-Sensitive Yoga modules, at the Center for Yoga and Mindfulness in Skørping, Northern Jutland. With a total experience of a dozen of professional and certifying trainings, I gained a thorough experience in empowering new teachers in acquiring new skills, develop confidence and gain depth in their approach to Yoga. This has been a fantastic experience, and I would happy to forward the referrals of my previous trainees.\n\nMy approach weaves together physical health and mental well-being, giving students practical tools for self-awareness and emotional regulation. While I currently teach in English, I understand Danish and can support a diverse student community.\n\nYou can find more about my experience and read student testimonials on my social media (\'Yoga & Therapy with Vanille Simeon\' on Facebook). I come with excellent feedbacks and recommendations, and I attach here my resume for your reference.\n\nI would be delighted to join your team.\n\nThank you very much for your time and consideration. I look forward to hearing from you.\n\nWarm regards,\nVanille',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-02-08T13:33:15Z',
    file_count: 2,
    file_names: 'CV: VanilleSimeon_Yoga_Resume2026.pdf — https://drive.google.com/file/d/1K63F920We42hdHUZdD_7qa7d5cc3S7jP/view?usp=drivesdk | EXTRA: VanilleSimeon_photo.jpg — https://drive.google.com/file/d/1QP6T6h1T5vwjf5DxSByEggehLTIsu6lE/view?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Roxanne',
    last_name: 'Pelardy',
    email: 'roxanne.pelardy@gmail.com',
    phone: '93888205',
    category: 'Yoga / Meditation Teacher, Kurser & workshops, Mentorship & privates',
    subcategory: 'Hatha, Meditation, Breathwork',
    other_topic: '',
    role: 'Assistant lead trainer',
    experience: '0–2 år',
    links: '',
    city_country: 'Copenhagen',
    languages: 'English, French',
    background: '200 hours Hatha yoga YTTC',
    message: 'Classes and workshops.',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-02-11T13:11:26Z',
    file_count: 1,
    file_names: 'CV: CV Yoga.pdf — https://drive.google.com/file/d/1PmVSx5kp7oi7NYItOIkNGixaor_wb0gb/view?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Olivia',
    last_name: 'Vasylyeva',
    email: 'oliviavasylyeva12@gmail.com',
    phone: '4526195100',
    category: 'Yoga / Meditation Teacher',
    subcategory: 'Vinyasa, Hatha, Hot Yoga, Meditation, Breathwork, Pilates',
    other_topic: '',
    role: 'Lead trainer',
    experience: '0–2 år',
    links: '',
    city_country: 'Danmark',
    languages: 'Dansk og Englesk flydende',
    background: '200 hr yoga teacher training fra House of Om\nProfessionel pilates instruktør\nMange års privat praksis\nPrivat læring i mange wellness kategorier - massage, lymfer, nervesystemet, kinesisk medicin, kost, næring, muskelopbybgning, fleksibilitet mm',
    message: 'Ville elske workshops, eller blot faste eller vikartimer i normale formater. Foretrækker selv yoga timer hvor der bliver fokuseret på fleksibilieten eller rigtig slow flow for interoception. Og for pilates elsker jeg et godt burn uden at udbrænde',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-02-15T10:52:30Z',
    file_count: 1,
    file_names: 'CV: Olivia Vasylyeva.pdf — https://drive.google.com/file/d/1B1j1n9EHZgYXBB-Ujrm0cGQH5TtwcG3a/view?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Heidi',
    last_name: 'Latva',
    email: 'heidilatvan@gmail.com',
    phone: '4527588172',
    category: 'Yoga / Meditation Teacher, Kurser & workshops, Mentorship & privates, Andet samarbejde',
    subcategory: 'Vinyasa, Yin, Hatha, Hot Yoga, Meditation, Breathwork, Pilates, Yoga for seniors, Dybe backbends, Inversions, Splits & hip opening, Mobilitet & styrke, Andet workshop, Privat undervisning (praksis)',
    other_topic: 'Leje sal til privat gruppe',
    role: 'Underviser / modul',
    experience: '10+ år',
    links: 'https://www.instagram.com/heidi.latva/',
    city_country: 'Denmark',
    languages: 'Dansk, Engelsk, Finsk',
    background: 'Yoga instruktør i FW mellem 2020-2023 (yin, vinyasa, flow, hatha) mest hot yoga Cerfitikat gemmen FW academy\nSomatic Pilates instruktør certifikat 300h (reformer, cadillac, chair, spine corrector, tower)\nCompetitive skater 1998-2004\nCompetitive Danser i solo, gruppe og duo (jazz, modern, hip hop) 2014-2012\nProfessionelt cirkus artist (luft akrobat og roller skøjter) 2013-nu',
    message: 'Privat undervisning, gruppe undervisning, workshops og egen grupper i studio som har ikke måske dyrket yoga aldrig. Kan undervise omkring 6-8 timer per uge. Jeg er vildt med undervise yin yoga med også inversion og splits. Jeg har faktisk undervist håndstand workshops.',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-02-15T12:12:03Z',
    file_count: 1,
    file_names: 'CV: CV 2026 Heidi Maria.pdf — https://drive.google.com/file/d/12sHfPJfzMFE-DXCZH6doZKu0IX9jpTLm/view?usp=drivesdk',
    status: 'New',
    notes: []
  }
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  // Admin-only: require auth token
  const authResult = await requireAuth(event);
  if (authResult.error) return authResult.error;

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  // Safety check
  const params = new URLSearchParams((event.queryStringParameters || {}));
  if ((event.queryStringParameters || {}).confirm !== 'seed') {
    return jsonResponse(400, { ok: false, error: 'Missing confirm=seed param' });
  }

  try {
    const db = getDb();
    const col = db.collection('leads');

    // Build map of existing career emails → doc ref (to overwrite archived ones)
    const existingSnap = await col.where('type', '==', 'careers').get();
    const existingByEmail = {};
    existingSnap.forEach(doc => {
      const d = doc.data();
      if (d.email) {
        const key = d.email.toLowerCase().trim();
        existingByEmail[key] = { ref: doc.ref, archived: d.archived === true || d.status === 'Archived' };
      }
    });

    let added = 0;
    let updated = 0;
    let skipped = 0;
    const batch = db.batch();

    for (const row of SEED_DATA) {
      const emailKey = (row.email || '').toLowerCase().trim();
      const existing = existingByEmail[emailKey];

      const seedDoc = {
        ...row,
        type: 'careers',
        source: 'Careers page',
        status: row.status || 'New',
        archived: false,
        converted: false,
        converted_at: null,
        application_id: null,
        unsubscribed: false,
        call_attempts: 0,
        sms_status: '',
        last_contact: null,
        followup_date: null,
        ytt_program_type: '',
        program: '',
        course_id: '',
        cohort_label: '',
        preferred_month: '',
        accommodation: 'No',
        housing_months: '',
        service: row.category || 'Careers',
        subcategories: row.subcategory || '',
        created_at: new Date(row.submitted_at),
        updated_at: new Date()
      };

      if (existing && existing.archived) {
        // Overwrite archived duplicate with fresh seed data
        batch.set(existing.ref, seedDoc);
        updated++;
      } else if (existing) {
        // Already exists and is active — skip
        skipped++;
      } else {
        // New entry
        batch.set(col.doc(), seedDoc);
        added++;
      }
    }

    await batch.commit();

    console.log(`[careers-seed] Added ${added}, updated ${updated}, skipped ${skipped}`);
    return jsonResponse(200, { ok: true, added, updated, skipped });

  } catch (err) {
    console.error('[careers-seed] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
