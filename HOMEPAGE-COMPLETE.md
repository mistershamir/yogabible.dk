# ✅ Homepage Architecture Complete!

Your Yoga Bible DK homepage is now fully architected with all sections implemented. Here's what you have:

---

## 🎨 Complete Homepage Structure

### 1. **Hero Section** ✅
- **Location**: [index.html:308-321](src/index.html#L308-L321)
- **What it shows**:
  - Main headline: "Et sted. To veje." / "One place. Two paths."
  - Subtitle explaining Yoga Bible's mission
  - Trust indicators (Since 2014, 500+ graduates, 4.8★ rating, etc.)
- **📸 Image needed**: 1920x1080px background image or 10-15s video loop
  - See IMAGE-GUIDE.md Section 1

---

### 2. **Trust Badges Section** ✅ NEW!
- **Location**: [index.html:323-375](src/index.html#L323-L375)
- **What it shows**: 4 trust indicators with icons
  - Since 2014 (11+ years experience)
  - 500+ Graduates (Certified teachers)
  - 4.8★ Rating (700+ reviews)
  - Real-class Practice (Hands-on training)
- **Current state**: Using SVG placeholder icons
- **📸 Images needed**: Four 120x120px badge/icon graphics
  - See IMAGE-GUIDE.md Section 7

---

### 3. **Program Pathways Section** ✅
- **Location**: [index.html:377-408](src/index.html#L377-L408)
- **What it shows**: Two program cards side-by-side
  - **18-Week Flexible Program**
    - Badge: "Fleksibel"
    - Features: Start dates, schedule, pass rate, certification
  - **4-Week Intensive Program** (featured/highlighted)
    - Badge: "Intensiv"
    - Features: Compact learning, housing, certification
- **📸 Images optional**: 80x80px icons or 400x300px card images
  - See IMAGE-GUIDE.md Section 2

---

### 4. **Courses Section** ✅
- **Location**: [index.html:410-464](src/index.html#L410-L464)
- **What it shows**: Three course cards with images
  - **Inversions**: Handstand, forearm stand, spotting
  - **Splits**: Hip mobility, hamstring flexibility
  - **Backbends**: Chest opening, spine strength
- **Current state**: Using Squarespace CDN placeholder images
- **📸 Images needed**: Three 800x500px hero images
  - See IMAGE-GUIDE.md Section 3
  - **PRIORITY**: These are the most visible images!

---

### 5. **Instructors Section** ✅ NEW!
- **Location**: [index.html:466-517](src/index.html#L466-L517)
- **What it shows**: 3 instructor profile cards
  - Circular headshot photo
  - Name
  - Title (Lead Instructor, Senior Instructor, etc.)
  - Short bio (E-RYT 500, specialties, etc.)
- **Current state**: Using placeholder images and generic text
- **📸 Images needed**: 3-6 professional headshots at 400x400px
  - See IMAGE-GUIDE.md Section 4
- **✏️ Content needed**: Replace with actual instructor names and bios
  - Edit at [index.html:469-517](src/index.html#L469-L517)

---

### 6. **Testimonials Section** ✅ NEW!
- **Location**: [index.html:519-591](src/index.html#L519-L591)
- **What it shows**: 3 testimonial cards with star ratings
  - 5-star rating
  - Student quote/review
  - Student avatar (circular photo)
  - Name and program info
- **Current state**: Using placeholder testimonials
- **📸 Images optional**: 80x80px circular avatars (can use initials)
  - See IMAGE-GUIDE.md Section 5
- **✏️ Content needed**: Replace with real student testimonials
  - Get permission from students
  - Edit at [index.html:525-591](src/index.html#L525-L591)

---

### 7. **Video Section** ✅ NEW!
- **Location**: [index.html:593-625](src/index.html#L593-L625)
- **What it shows**: Promotional video embed
  - Title: "Oplev Yoga Bible" / "Experience Yoga Bible"
  - Subtitle: "Take a look inside our studio"
  - Video player (16:9 aspect ratio)
- **Current state**: Showing placeholder with play icon
- **📸 Video needed**: 2-3 minute promotional video (1280x720px)
  - See IMAGE-GUIDE.md Section 8
- **How to add**: Uncomment the iframe code and add your YouTube/Vimeo URL
  - Edit at [index.html:613-622](src/index.html#L613-L622)

---

### 8. **Final CTA Section** ✅
- **Location**: [index.html:627-635](src/index.html#L627-L635)
- **What it shows**:
  - Bold headline: "Klar til at starte din rejse?"
  - Description: "Ansøg i dag og bliv en del af Yoga Bible's community"
  - Large "Ansøg nu" button
- **Current state**: Complete, no images needed
- **Note**: Button currently links to "#" - update when application page is ready

---

## 🎯 Priority Order for Images

### Phase 1: Launch Ready (Must Have)
1. ✅ Hero background image/video
2. ✅ Course card images (Inversions, Splits, Backbends) — **MOST VISIBLE**
3. ✅ Logo (already integrated)

### Phase 2: Enhancement (Should Have)
4. ⏳ Instructor headshots (3-6 photos)
5. ⏳ Trust badge icons (4 icons)
6. ⏳ Program card images (optional)

### Phase 3: Optimization (Nice to Have)
7. ⏳ Testimonial avatars (optional)
8. ⏳ Promotional video (2-3 minutes)
9. ⏳ Studio gallery images (future section)

---

## 📂 Where Images Should Go

When you have your images, save them here:
```
src/assets/images/
├── hero/
│   ├── hero-desktop.jpg (1920x1080px)
│   ├── hero-mobile.jpg (optional)
│   └── hero-video.mp4 (optional)
├── courses/
│   ├── inversions.jpg (800x500px) ← PRIORITY
│   ├── splits.jpg (800x500px) ← PRIORITY
│   └── backbends.jpg (800x500px) ← PRIORITY
├── instructors/
│   ├── instructor-1.jpg (400x400px)
│   ├── instructor-2.jpg (400x400px)
│   └── instructor-3.jpg (400x400px)
├── testimonials/
│   ├── student-1.jpg (80x80px, optional)
│   ├── student-2.jpg (80x80px, optional)
│   └── student-3.jpg (80x80px, optional)
└── badges/
    ├── since-2014.svg (120x120px)
    ├── graduates-500.svg (120x120px)
    ├── rating-4-8.svg (120x120px)
    └── real-class.svg (120x120px)
```

---

## ✏️ Content That Needs Updating

### 1. Instructor Information
**File**: [index.html:469-517](src/index.html#L469-L517)

Replace these placeholders:
```html
<h3 class="instructor-card__name">Instruktør Navn</h3>
<p class="instructor-card__title">Lead Instruktør</p>
<p class="instructor-card__bio">
  E-RYT 500 certificeret med 10+ års erfaring...
</p>
```

With actual instructor names, titles, and bios.

### 2. Testimonial Quotes
**File**: [index.html:525-591](src/index.html#L525-L591)

Replace placeholder quotes with real student testimonials:
```html
<p class="testimonial-card__quote">
  "Real testimonial text here..."
</p>
<strong class="testimonial-card__name">Real Name</strong>
<span class="testimonial-card__meta">Program info</span>
```

### 3. Video Embed
**File**: [index.html:613-622](src/index.html#L613-L622)

Uncomment the iframe and add your video URL:
```html
<iframe
  src="https://www.youtube.com/embed/YOUR_VIDEO_ID"
  title="Yoga Bible Introduction"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen
></iframe>
```

---

## 🌐 Bilingual Support

All text is automatically translated between Danish and English based on domain:
- `www.yogabible.dk` → Danish
- `en.yogabible.dk` → English

Translations are managed in [header.js:26-148](src/js/header.js#L26-L148)

All new sections have complete Danish/English translations! ✅

---

## 💻 Technical Implementation

### CSS Styling
All new sections have responsive styling in [main.css:1167-1437](src/css/main.css#L1167-L1437)

Includes:
- Trust badges grid (responsive 4→2→1 columns)
- Instructor cards with circular photos
- Testimonial cards with shadows and hover effects
- Video section with 16:9 aspect ratio
- Mobile breakpoints at 768px and 480px

### JavaScript Translations
All new translation keys added to [header.js](src/js/header.js):
- `trust.*` keys for badge section
- `instructors.*` keys for instructor section
- `testimonial.*` keys for testimonial section
- `video.*` keys for video section

---

## 🚀 Next Steps

1. **Get Professional Photos** (Highest Priority)
   - Hire photographer OR use existing content
   - See IMAGE-GUIDE.md for specifications
   - Start with course card images (most visible)

2. **Update Instructor Content**
   - Gather instructor names, titles, bios
   - Take or find professional headshots
   - Update HTML with real information

3. **Collect Testimonials**
   - Get permission from 3-5 recent graduates
   - Write authentic testimonial quotes
   - Optional: Get student photos

4. **Create Promotional Video**
   - 2-3 minute studio tour
   - Include instructor introductions
   - Show class footage
   - Upload to YouTube/Vimeo

5. **Test on Real Devices**
   - View on iPhone/iPad
   - View on Android devices
   - Test all breakpoints
   - Verify touch interactions

6. **Build Subpages**
   - Create individual course pages
   - Create program detail pages
   - Create contact page
   - Link from navigation

---

## 📞 Questions?

Refer to these guides:
- **QUICKSTART.md** - How to view and deploy
- **IMAGE-GUIDE.md** - Detailed image specifications
- **README.md** - Full project documentation

---

**🎉 Your homepage is architecturally complete and ready for content!**

The structure is professional, responsive, and fully bilingual. Once you add real images and content, you'll have a stunning website ready to launch.
