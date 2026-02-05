# Yoga Bible — Complete Brand Asset Kit

## 📦 Package Contents

**332 files** organized for every platform and use case.

---

## 🎨 Brand Specifications

| Element | Value |
|---------|-------|
| **Primary Color** | `#F85D03` / RGB(248, 93, 3) |
| **Font** | Custom wordmark (see source files) |
| **Style** | Line art, continuous stroke |

---

## 📁 Directory Structure

```
asset-kit/
├── source-files/           # Original vector files (SVG) + high-res PNG
│
├── brand-assets/
│   ├── icon/               # Square icon in all variants
│   │   ├── orange-on-transparent/
│   │   ├── orange-on-white/
│   │   ├── orange-on-black/
│   │   ├── white-on-transparent/
│   │   ├── white-on-orange/
│   │   ├── white-on-black/
│   │   ├── black-on-transparent/
│   │   └── black-on-white/
│   │
│   └── logo-horizontal/    # Icon + "YOGA BIBLE" wordmark
│       ├── orange-on-transparent/
│       ├── orange-on-white/
│       ├── orange-on-black/
│       ├── white-on-transparent/
│       ├── white-on-orange/
│       └── white-on-black/
│
├── favicon/                # Website favicons (all sizes + .ico)
│
├── social-media/
│   ├── facebook/           # Profile images
│   ├── instagram/
│   ├── linkedin/
│   ├── twitter/
│   ├── youtube/
│   ├── tiktok/
│   └── covers/             # Banner/cover images for all platforms
│
├── app-icons/
│   ├── ios/                # Complete Apple HIG set
│   └── android/            # All densities + Play Store
│
├── web/
│   ├── pwa/                # Progressive Web App icons + maskable
│   ├── og-images/          # Open Graph social sharing images
│   └── email/              # Email signature icons
│
├── google-business/        # Google Business Profile images
│
└── print/
    ├── icon/               # High-res icons (300-3600px)
    └── logo/               # High-res logos
```

---

## 🔖 Quick Reference

### Need this? → Use this file:

| Purpose | File Path |
|---------|-----------|
| **Website favicon** | `favicon/favicon.ico` |
| **Browser tab (retina)** | `favicon/favicon-32x32.png` |
| **iOS home screen** | `favicon/apple-touch-icon.png` |
| **Website header logo** | `brand-assets/logo-horizontal/orange-on-transparent/logo-100h.png` |
| **Dark website header** | `brand-assets/logo-horizontal/white-on-transparent/logo-100h.png` |
| **Facebook profile** | `social-media/facebook/facebook-profile-white-bg.png` |
| **Instagram profile** | `social-media/instagram/instagram-profile-white-bg.png` |
| **LinkedIn profile** | `social-media/linkedin/linkedin-profile-white-bg.png` |
| **Twitter/X profile** | `social-media/twitter/twitter-profile-white-bg.png` |
| **YouTube profile** | `social-media/youtube/youtube-profile-white-bg.png` |
| **TikTok profile** | `social-media/tiktok/tiktok-profile-white-bg.png` |
| **Facebook cover** | `social-media/covers/facebook-cover.png` |
| **LinkedIn banner** | `social-media/covers/linkedin-cover.png` |
| **Twitter header** | `social-media/covers/twitter-cover.png` |
| **YouTube banner** | `social-media/covers/youtube-cover.png` |
| **iOS App Store** | `app-icons/ios/AppStore-1024.png` |
| **Google Play Store** | `app-icons/android/playstore/playstore-512.png` |
| **PWA icon** | `web/pwa/pwa-512.png` |
| **OG image (social share)** | `web/og-images/og-1200x630.png` |
| **Email signature** | `web/email/signature-100.png` |
| **Google Business profile** | `google-business/profile-720x720.png` |
| **Business card** | `print/icon/icon-1200px-white.png` |
| **Large banner** | `print/logo/logo-1200h-white.png` |

---

## 📱 Social Media Specifications

| Platform | Profile Size | Cover Size |
|----------|--------------|------------|
| Facebook | 180×180 | 820×312 |
| Instagram | 320×320 | 1080×566 |
| LinkedIn | 400×400 | 1584×396 |
| Twitter/X | 400×400 | 1500×500 |
| YouTube | 800×800 | 2560×1440 |
| TikTok | 200×200 | 1920×1080 |

---

## 📲 App Icon Specifications

### iOS (app-icons/ios/)
| File | Size | Usage |
|------|------|-------|
| Icon-20@1x | 20×20 | Notification (iPad) |
| Icon-20@2x | 40×40 | Notification (iPhone) |
| Icon-20@3x | 60×60 | Notification (iPhone Plus) |
| Icon-29@1x | 29×29 | Settings (iPad) |
| Icon-29@2x | 58×58 | Settings (iPhone) |
| Icon-29@3x | 87×87 | Settings (iPhone Plus) |
| Icon-40@1x | 40×40 | Spotlight (iPad) |
| Icon-40@2x | 80×80 | Spotlight (iPhone) |
| Icon-40@3x | 120×120 | Spotlight (iPhone Plus) |
| Icon-60@2x | 120×120 | App (iPhone) |
| Icon-60@3x | 180×180 | App (iPhone Plus) |
| Icon-76@1x | 76×76 | App (iPad) |
| Icon-76@2x | 152×152 | App (iPad Retina) |
| Icon-83.5@2x | 167×167 | App (iPad Pro) |
| **AppStore-1024** | 1024×1024 | App Store |

### Android (app-icons/android/)
| Density | Launcher | Round | Usage |
|---------|----------|-------|-------|
| mdpi | 48×48 | 48×48 | ~160dpi |
| hdpi | 72×72 | 72×72 | ~240dpi |
| xhdpi | 96×96 | 96×96 | ~320dpi |
| xxhdpi | 144×144 | 144×144 | ~480dpi |
| xxxhdpi | 192×192 | 192×192 | ~640dpi |
| **Play Store** | 512×512 | — | Google Play |

---

## 🌐 Web Implementation

### Favicon HTML
```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
```

### PWA Manifest (manifest.json)
```json
{
  "icons": [
    { "src": "/pwa-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/pwa-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### Open Graph Meta Tags
```html
<meta property="og:image" content="https://yogabible.dk/og-1200x630.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://yogabible.dk/og-1200x630.png">
```

---

## 🖨️ Print Guidelines

| Size | Pixels | Print Size (300dpi) |
|------|--------|---------------------|
| 300px | 300×300 | ~1 inch |
| 600px | 600×600 | ~2 inches |
| 1200px | 1200×1200 | ~4 inches |
| 2400px | 2400×2400 | ~8 inches |
| 3600px | 3600×3600 | ~12 inches |

### For Offset/CMYK Printing
The PNG files are in RGB. For professional offset printing:
1. Open in Adobe Photoshop or Illustrator
2. Convert to CMYK color mode
3. Use the SVG source files for best results
4. Export as PDF/X-1a or TIFF

---

## ⚠️ Usage Guidelines

### Do ✓
- Use provided files without modification
- Maintain minimum clear space (15% of icon width)
- Use white version on dark backgrounds
- Use orange version on light backgrounds

### Don't ✗
- Rotate, skew, or distort the logo
- Change the colors
- Add effects (shadows, glows, outlines)
- Use low-resolution files for print
- Stretch or compress disproportionately

---

## 📄 Source Files

For maximum flexibility, the original vector files are included:

- `yoga-icon.svg` — Icon only (Adobe Illustrator)
- `yogabible.svg` — Full horizontal logo (Adobe Illustrator)

These can be opened in:
- Adobe Illustrator
- Affinity Designer
- Figma
- Sketch
- Inkscape (free)

---

## 📧 Support

For additional sizes, formats, or custom applications, the SVG source files can be scaled infinitely without quality loss.

---

**Generated:** January 2026  
**Total Files:** 332  
**Brand:** Yoga Bible (yogabible.dk)
