# 📸 Image & Video Guide for Yoga Bible Homepage

## Required Media Assets

### 1. **Hero Section** (Top of page)
**Type:** Large background image OR video
**Dimensions:** 1920x1080px minimum
**Subject:**
- Wide shot of yoga class in action
- Warm, inviting atmosphere
- Professional instruction visible
- Could be: Teacher assisting student in pose, group class, or studio interior

**Alternative:** Short 10-15 second video loop of class in session

---

### 2. **Program Cards** (Two cards: 18-week & 4-week)
**Type:** Icon or small image
**Dimensions:** 80x80px icons OR 400x300px card images
**Subject:**
- **18-Week Card:** Calendar/clock icon OR student practicing alongside laptop (flexible schedule concept)
- **4-Week Card:** Intensive training icon OR group of students in immersive workshop setting

---

### 3. **Course Cards** (Three cards: Inversions, Splits, Backbends)
**Type:** Hero images for each course
**Dimensions:** 800x500px (16:10 ratio)
**Current placeholders at:**
- `inversions-course.jpg`
- `splits-course.jpg`
- `backbends-course.jpg`

**Subject Matter:**

#### **Inversions Card**
- Handstand, forearm stand, or headstand
- Preferably with spotter/instructor helping
- Dynamic, impressive pose
- Warm, encouraging environment

#### **Splits Card**
- Full or working splits position
- Could show progression (multiple frames)
- Focus on flexibility and safe stretching
- Professional instruction visible

#### **Backbends Card**
- Wheel pose, bridge, or deep backbend
- Shows chest opening and spine extension
- Instructor guidance if possible
- Safe, controlled environment

---

### 4. **Instructor/Team Section** (NEW - Should be added)
**Type:** Grid of headshots
**Dimensions:** 400x400px per instructor (square)
**Subject:**
- Professional headshots of lead instructors
- Warm, approachable expressions
- Consistent lighting and background
- 3-6 key instructors

---

### 5. **Testimonials Section** (NEW - Should be added)
**Type:** Student photos (optional, can be text-only)
**Dimensions:** 80x80px circular avatars
**Subject:**
- Real graduates/students (with permission)
- Diverse representation
- Authentic, candid shots
- Can use initials if photos not available

---

### 6. **Studio/Facility Section** (NEW - Should be added)
**Type:** Gallery of 3-4 studio photos
**Dimensions:** 600x400px each
**Subject:**
- Clean, well-lit yoga studio space
- Equipment and props visible
- Welcoming atmosphere
- Multiple angles showing size and amenities

---

### 7. **Social Proof Banner** (Trust indicators)
**Type:** Small badge icons
**Dimensions:** 120x120px per badge
**Subject:**
- "Since 2014" badge/icon
- "500+ Graduates" icon
- "4.8★ Rating" icon
- "Yoga Alliance Certified" logo (if applicable)

---

### 8. **Video Section** (Recommended addition)
**Type:** Embedded video or thumbnail
**Dimensions:** 1280x720px (16:9 ratio)
**Subject:**
- 2-3 minute promotional video
- Introduction to Yoga Bible
- Tour of facilities
- Student testimonials
- Instructor introductions

**Where to place:** Between courses section and final CTA

---

## Image Optimization

### Format
- Use WebP format with JPEG fallback
- Compress to ~80% quality
- Use lazy loading for all images

### Naming Convention
```
hero-yoga-class-copenhagen.jpg
program-18-week-flexible.jpg
program-4-week-intensive.jpg
course-inversions-handstand.jpg
course-splits-flexibility.jpg
course-backbends-wheel-pose.jpg
instructor-[name].jpg
studio-main-room.jpg
studio-reception.jpg
testimonial-[initials].jpg
```

### Alt Text Examples
```html
<img src="hero.jpg" alt="Yoga students practicing in bright Copenhagen studio with instructor guidance">
<img src="inversions.jpg" alt="Professional instructor spotting student in handstand during inversions course">
<img src="splits.jpg" alt="Yoga practitioner demonstrating full splits with proper alignment">
```

---

## Where to Get Images

### 1. **Professional Photoshoot** (Recommended)
- Hire yoga photographer
- Capture authentic class sessions
- Get instructor headshots
- Cost: 5,000-15,000 DKK

### 2. **Use Existing Content**
- Instagram posts from @yoga_bible
- Past class photos (with student permission)
- Marketing materials you already have

### 3. **Stock Photos** (Temporary solution only)
- Unsplash.com (free, high quality)
- Pexels.com (free, yoga-specific)
Search terms: "yoga class Copenhagen", "yoga teacher training", "handstand", "splits yoga"

---

## Video Requirements

### Hero Video (if using)
- 15-30 seconds maximum
- Silent or subtle background music
- Loop seamlessly
- Compressed: < 5MB file size
- Format: MP4 (H.264 codec)

### Promotional Video
- 2-3 minutes
- Include captions (accessibility)
- Hosted on YouTube or Vimeo
- Embed responsively

---

## Priority Order

**Phase 1 (Launch Ready):**
1. Hero image/video
2. Three course card images (Inversions, Splits, Backbends)
3. Logo (already have)

**Phase 2 (Enhancement):**
4. Program card images
5. Instructor headshots
6. Studio photos

**Phase 3 (Optimization):**
7. Testimonial photos
8. Promotional video
9. Additional gallery images

---

## File Structure
```
src/assets/images/
├── hero/
│   ├── hero-desktop.jpg
│   ├── hero-mobile.jpg
│   └── hero-video.mp4
├── courses/
│   ├── inversions.jpg
│   ├── splits.jpg
│   └── backbends.jpg
├── programs/
│   ├── 18-week.jpg
│   └── 4-week.jpg
├── instructors/
│   ├── instructor-1.jpg
│   └── instructor-2.jpg
├── studio/
│   ├── main-room.jpg
│   └── reception.jpg
└── badges/
    ├── since-2014.svg
    ├── graduates-500.svg
    └── rating-4-8.svg
```

---

**Ready to implement images?** Let me know when you have the images ready and I'll integrate them!
