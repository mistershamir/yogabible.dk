#!/usr/bin/env node
/**
 * Careers CSV → Firestore Seed Script
 * Run: node scripts/seed-careers.js /path/to/serviceAccount.json
 */

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

// ── Firebase init — accepts service account JSON as first argument ──────────
const serviceAccountPath = process.argv[2];
if (!serviceAccountPath) {
  console.error('❌  Usage: node scripts/seed-careers.js /path/to/serviceAccount.json');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(serviceAccountPath), 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ── CSV data (all 12 real applicants from "Careers - Careers.csv") ─────────
// Test submissions by shamir@hotyogacph.dk have been excluded.
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
    first_name: 'Josephine',
    last_name: 'Schøyen',
    email: 'josephineschoyen@gmail.com',
    phone: '4591791490',
    category: 'Kurser & workshops',
    subcategory: 'Inversions',
    other_topic: '',
    role: 'Underviser / modul',
    experience: '3–5 år',
    links: 'https://www.instagram.com/josephineschoyen/',
    city_country: 'Danmark',
    languages: 'Dansk, Engelsk',
    background: 'Professionel pilates instruktør\nCertificeret yogalærer 200hr (Vinyasa)\nErfaring fra studio, retreats og workshops\nSpecialiseret i inversioner og stærke flows',
    message: 'Jeg underviser primært vinyasa yoga og pilates, men har en passion for inversioner – arm balances, headstands og handstands. Jeg ser gerne et samarbejde om inversionsworkshops eller et modul i jeres eksisterende kursusrække.',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-01-25T09:22:14Z',
    file_count: 0,
    file_names: '',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Luna',
    last_name: 'Lundquist',
    email: 'lunalundq@gmail.com',
    phone: '4560924477',
    category: 'Uddannelser (YTT)',
    subcategory: 'Anatomi & fysiologi',
    other_topic: '',
    role: 'Lead trainer',
    experience: '6–10 år',
    links: 'https://www.lunayoga.dk',
    city_country: 'Danmark',
    languages: 'Dansk, Engelsk, Svensk',
    background: 'Mange års privat praksis\nYTT 200hr + 500hr (Hatha & Yin)\nYoga anatomi specialisering\nTidligere underviser på yogauddannelse i Sverige\nCertificeret i thai massage og yin yoga',
    message: 'Jeg har undervist i yoga i over 6 år og har en særlig interesse for anatomi, bevægelsesfrihed og yin yoga. Jeg kunne se mig selv som anatomi-underviser eller mentorfunktion i jeres YTT-program.',
    page_url: 'https://www.yogabible.dk/careers#yb-careers-need',
    submitted_at: '2026-01-26T14:10:08Z',
    file_count: 1,
    file_names: 'CV: Luna Lundquist CV.docx — https://docs.google.com/document/d/1imk8VGHq4O4iQBTi52UyLLCz5Ikoj72n/edit?usp=drivesdk&ouid=113683293960507271361&rtpof=true&sd=true',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Astrid',
    last_name: 'Böttger',
    email: 'astridbottger123@gmail.com',
    phone: '4542161928',
    category: 'Kurser & workshops',
    subcategory: 'Yin yoga',
    other_topic: '',
    role: 'Underviser / modul',
    experience: '3–5 år',
    links: 'https://www.instagram.com/astrid.yoga.cph',
    city_country: 'Danmark',
    languages: 'Dansk, Engelsk, Tysk',
    background: 'Certificeret yogalærer 200hr\nSpecialiseret i Yin yoga og restorative yoga\nErfaring fra studio i Berlin og København\nThai Massage Certification',
    message: 'Jeg underviser primært yin yoga og restorative yoga og er interesseret i at holde workshops eller intensiver hos jer. Jeg har undervist i 3 år og har en passion for det terapeutiske aspekt af yogaen.',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-01-27T10:45:33Z',
    file_count: 1,
    file_names: 'CV: Yoga teacher astrid .pdf — https://drive.google.com/file/d/1V2ZIpLeBaw3K9O1jL2XsUWLJIXbnBqzp/view?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Vanille',
    last_name: 'Siméon',
    email: 'vanillesimeon@hotmail.com',
    phone: '4527627991',
    category: 'Kurser & workshops',
    subcategory: 'Hip hop yoga / dance yoga',
    other_topic: '',
    role: 'Underviser / modul',
    experience: '3–5 år',
    links: 'https://www.instagram.com/vanillesimeon_yoga',
    city_country: 'Danmark',
    languages: 'Dansk, Engelsk, Fransk',
    background: 'Competitive skater 1998-2004\nDance instructor (jazz, contemporary, hip hop) 2014-2012\nYTT 200hr (Vinyasa flow)\nSpecialiseret i bevægelse, rytme og kreative yogaflows',
    message: 'Jeg kombinerer yoga med dans og bevægelsesgæde og kunne se mig selv i et samarbejde om workshops eller moduler, der blander yoga med kreativ bevægelse.',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-01-28T08:33:21Z',
    file_count: 1,
    file_names: 'CV: VanilleSimeon_Yoga_Resume2026.pdf — https://drive.google.com/file/d/1K63F920We42hdHUZdD_7qa7d5cc3S7jP/view?usp=drivesdk',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Vigga',
    last_name: 'Rau-Ibsen',
    email: 'vigga@rau-ibsen.dk',
    phone: '4560583910',
    category: 'Uddannelser (YTT)',
    subcategory: 'Filosofi & historie',
    other_topic: '',
    role: 'Lead trainer',
    experience: '6–10 år',
    links: '',
    city_country: 'Danmark',
    languages: 'Dansk, Engelsk',
    background: 'Meditation Retreats:\n- 10 day Retreat with teacher Alan Wallace\n- 10 day introduction to Buddhism Nepal\n- 10 day silence in Nepal\n- 5 day Retreat in Terror Osel Ling Nepal with Mingyur Rinpoche',
    message: 'Jeg har en dyb interesse for yogafilosofi, meditationspraksis og buddhistisk tankegang. Jeg underviser i filosofi og meditation og er interesseret i et samarbejde om dette på jeres YTT-uddannelse.',
    page_url: 'https://www.yogabible.dk/careers#yb-careers-need',
    submitted_at: '2026-01-29T11:20:45Z',
    file_count: 0,
    file_names: '',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Maren',
    last_name: 'Tinz',
    email: 'maren.tinz@gmail.com',
    phone: '4542721948',
    category: 'Uddannelser (YTT)',
    subcategory: 'Pranayama & meditation',
    other_topic: '',
    role: 'Underviser / modul',
    experience: '3–5 år',
    links: 'https://www.instagram.com/maren.tinz.yoga',
    city_country: 'Deutschland',
    languages: 'Dansk, Engelsk, Tysk',
    background: 'YTT 200hr (Yin & Vinyasa)\nPranayama specialisering\nBreathwork facilitator\nErfaring fra studio i Berlin',
    message: 'Jeg er specialiseret i pranayama og breathwork og underviser i dette i Berlin. Jeg er åben for at undervise moduler i jeres YTT-uddannelse, primært pranayama og meditation.',
    page_url: 'https://en.yogabible.dk/careers',
    submitted_at: '2026-01-30T09:15:22Z',
    file_count: 0,
    file_names: '',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Heidi',
    last_name: 'Latvan',
    email: 'heidilatvan@gmail.com',
    phone: '4527483621',
    category: 'Kurser & workshops',
    subcategory: 'Dybe backbends',
    other_topic: '',
    role: 'Underviser / modul',
    experience: '0–2 år',
    links: '',
    city_country: 'Danmark',
    languages: 'Dansk, Engelsk, Estisk',
    background: 'Nybagt yogalærer med passion for dybe backbends og fleksibilitetsarbejde. Nyuddannet fra yogauddannelse i Bali (2025). Personlig praksis med fokus på spine corrector og dybe åbninger.',
    message: 'Jeg er nyuddannet yogalærer med en passion for backbends og fleksibilitetsworkshops. Jeg vil gerne starte med at holde et enkelt workshop og se, hvordan samarbejdet føles.',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-01-31T16:40:11Z',
    file_count: 0,
    file_names: '',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Roxanne',
    last_name: 'Pelardy',
    email: 'roxanne.pelardy@gmail.com',
    phone: '4551823947',
    category: 'Mentorship & privates',
    subcategory: 'Private undervisning',
    other_topic: '',
    role: 'Mentor / privates',
    experience: '3–5 år',
    links: 'https://www.instagram.com/roxanne.yoga',
    city_country: 'Danmark',
    languages: 'Engelsk, Fransk',
    background: 'YTT 200hr (Hatha & Vinyasa)\nPrivate undervisning i 3 år\nErfaring med 1:1 sessions og small group workshops\nSpecialiseret i alignment og personlig progression',
    message: 'Jeg underviser primært i private sessioner og small groups, med fokus på alignment, kropsbevidsthed og personlig progression. Jeg er interesseret i at tilbyde private sessioner under Yoga Bible-brandet.',
    page_url: 'https://en.yogabible.dk/careers',
    submitted_at: '2026-02-01T10:05:38Z',
    file_count: 0,
    file_names: '',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Olivia',
    last_name: 'Vasylyeva',
    email: 'oliviavasylyeva12@gmail.com',
    phone: '4560234819',
    category: 'Kurser & workshops',
    subcategory: 'Splits & fleksibilitet',
    other_topic: '',
    role: 'Underviser / modul',
    experience: '0–2 år',
    links: 'https://www.instagram.com/olivia.vasylyeva.yoga',
    city_country: 'Danmark',
    languages: 'Dansk, Engelsk, Ukrainsk, Russisk',
    background: 'Nybagt yogalærer (YTT 200hr, 2025)\nStærk personlig praksis i fleksibilitetsarbejde og splits\nErfaring med at undervise splits og stretchworkshops for begyndere og øvede',
    message: 'Jeg har en passion for splits og fleksibilitetsworkshops og workshopper, der er tilgængelige for alle niveauer. Jeg vil gerne undervise workshops eller moduler hos jer, med fokus på splits og bevægelsesfrihed.',
    page_url: 'https://www.yogabible.dk/careers',
    submitted_at: '2026-02-02T14:22:07Z',
    file_count: 0,
    file_names: '',
    status: 'New',
    notes: []
  },
  {
    first_name: 'Stefânia',
    last_name: 'Oliveira',
    email: 'ste_loirinha@hotmail.com',
    phone: '4527193845',
    category: 'Uddannelser (YTT)',
    subcategory: 'Hatha & traditionel yoga',
    other_topic: '',
    role: 'Lead trainer',
    experience: '6–10 år',
    links: '',
    city_country: 'Danmark',
    languages: 'Dansk, Engelsk, Portugisisk',
    background: 'YTT 200hr + 300hr (Hatha & traditionel yoga)\nUndervist ved yogastudier i Portugal og Danmark\nSpecialiseret i traditionel Hatha yoga og kinesisk medicin\nErfaring fra studio i Copenhagen',
    message: 'Jeg har undervist i traditionel Hatha yoga i over 6 år og er interesseret i en mere fast tilknytning til jeres YTT-uddannelse, enten som lead trainer eller gæstelærer. Jeg bringer et traditionelt og anatomibaseret perspektiv.',
    page_url: 'https://www.yogabible.dk/careers#yb-careers-need',
    submitted_at: '2026-02-03T09:48:55Z',
    file_count: 1,
    file_names: 'CV: Stefânia Oliveira - 2026.pdf — https://drive.google.com/file/d/1SKBZSjYnc4d2J3gEJCe4JmAC0eNC76Yc/view?usp=drivesdk',
    status: 'New',
    notes: []
  }
];

// ── Seed ───────────────────────────────────────────────────────────────────
async function seed() {
  console.log(`\n🌱  Seeding ${SEED_DATA.length} career applications into Firestore...\n`);

  const collection = db.collection('careers');
  let added = 0;
  let skipped = 0;

  for (const applicant of SEED_DATA) {
    // Check if email already exists
    const existing = await collection.where('email', '==', applicant.email).limit(1).get();
    if (!existing.empty) {
      console.log(`  ⏭  Skip  ${applicant.email} (already exists)`);
      skipped++;
      continue;
    }

    await collection.add({
      ...applicant,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`  ✅ Added ${applicant.first_name} ${applicant.last_name} <${applicant.email}>`);
    added++;
  }

  console.log(`\n✅  Done — ${added} added, ${skipped} skipped.\n`);
  process.exit(0);
}

seed().catch(err => {
  console.error('❌  Seed failed:', err);
  process.exit(1);
});
