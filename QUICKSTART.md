# 🚀 Quick Start Guide - Yoga Bible DK

## View Your New Site Right Now!

### Method 1: Double-click (Simplest)
1. Go to: `Desktop/yogabible-dk/src/`
2. Double-click `index.html`
3. Opens in your browser ✅

### Method 2: Using VS Code
1. Open `yogabible-dk` folder in VS Code
2. Right-click `src/index.html`
3. Select "Open with Live Server"
4. Site opens at `http://localhost:5500` ✅

### Method 3: Terminal
```bash
cd ~/Desktop/yogabible-dk/src
python3 -m http.server 8000
# Then visit: http://localhost:8000
```

---

## ✅ What's Working Now

### Header Navigation
- ✅ Sticky header with dropdown menus
- ✅ Mobile drawer navigation
- ✅ Language switcher (🇩🇰 🇬🇧)
- ✅ Social media icons
- ✅ "Apply" CTA button

### Homepage Sections
- ✅ Hero section with title and trust indicators
- ✅ Trust badges section (4 badges with SVG placeholders)
- ✅ Program pathways (18-week & 4-week cards)
- ✅ Courses section (Inversions, Splits, Backbends)
- ✅ Instructors section (3 instructor cards with placeholders)
- ✅ Testimonials section (3 testimonial cards)
- ✅ Video section (with placeholder)
- ✅ Final CTA section

### Responsive Design
- ✅ Desktop (980px+): Full navigation & grid layouts
- ✅ Mobile: Hamburger menu with drawer
- ✅ Tablet: Optimized layout
- ✅ All sections responsive

### Functionality
- ✅ Dropdown hover effects
- ✅ Mobile accordion groups
- ✅ Keyboard navigation (Escape key closes menus)
- ✅ Bilingual translations (DA/EN)
- ✅ Smooth animations
- ✅ Image placeholders ready for replacement

---

## 📋 What You Need to Do Next

### 1. Replace Images (Priority)
See **IMAGE-GUIDE.md** for detailed requirements. You need:

1. **Hero Section** (Top of page)
   - Large background image (1920x1080px) OR 10-15s video loop
   - Should show yoga class in action

2. **Trust Badges**
   - Four 120x120px badge icons (Currently using SVG placeholders)
   - Replace with custom graphics

3. **Course Cards** (Most visible)
   - Inversions image (800x500px)
   - Splits image (800x500px)
   - Backbends image (800x500px)

4. **Instructor Photos**
   - 3-6 professional headshots (400x400px square)
   - Update names and bios in HTML

5. **Testimonials**
   - Optional: Student photos (80x80px circular)
   - Update with real testimonial quotes

6. **Video Section**
   - 2-3 minute promotional video
   - Embed YouTube/Vimeo link in HTML

### 2. Update Content
1. **Instructor Information**: Edit names, titles, and bios in [index.html:436-475](src/index.html#L436-L475)
2. **Testimonials**: Replace placeholder quotes with real student feedback
3. **Footer**: Expand with contact info, social links, legal links

### 3. Create Subpages
Build pages for each menu item:
- `/200-hours-18-weeks-flexible-programs.html`
- `/200-hours-4-weeks-intensive-programs.html`
- `/inversions.html`
- `/splits.html`
- `/backbends.html`
- `/kontakt.html`
- etc.

---

## 🎨 How to Customize

### Change Colors
Edit `src/css/main.css`:

```css
:root {
  --yb-brand: #f75c03;  /* Change orange color */
  --yb-bg: #1C1C1C;     /* Change dark background */
}
```

### Change Logo
Replace in `src/index.html`:

```html
<img src="your-new-logo.png" alt="Yoga Bible" />
```

### Add New Menu Item
Edit `src/index.html` in the navigation section:

```html
<a class="ybhd-link" href="/new-page">New Menu Item</a>
```

---

## 🚀 Deploy to Internet

### Option 1: Netlify (Easiest)
1. Go to [netlify.com](https://netlify.com)
2. Sign up (free)
3. Drag and drop `src/` folder
4. Your site is live! ✅

### Option 2: GitHub Pages
1. Create GitHub account
2. Create new repository
3. Upload `src/` folder contents
4. Enable GitHub Pages in settings
5. Connect your domain

### Option 3: Vercel
1. Go to [vercel.com](https://vercel.com)
2. Sign up
3. Import from Git or upload folder
4. Deploy ✅

---

## 🆘 Need Help?

### Site won't load?
- Make sure you're in the `src/` folder
- Try using a local server (Method 2 or 3 above)

### Navigation not working?
- Open browser console (F12)
- Check for JavaScript errors
- Make sure `js/header.js` is loading

### Styles look wrong?
- Check that `css/main.css` is loading
- Clear browser cache (Cmd+Shift+R on Mac)

---

## 📞 Contact

**Email**: info@yogabible.dk
**Instagram**: [@yoga_bible](https://instagram.com/yoga_bible)

---

**Ready to Launch?** Follow the deployment steps above! 🚀
