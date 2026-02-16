# Concepts Page Images

Drop images here for the /concepts/ page. See the template comments in
`src/_includes/pages/concepts.njk` for exact filenames and dimensions.

**Cloudinary folders:** Images should also be uploaded to Cloudinary under:
- `yoga-bible-DK/concepts/hotyoga/` — Hot Yoga CPH assets
- `yoga-bible-DK/concepts/namaste/` — Namasté assets
- `yoga-bible-DK/concepts/vibro/` — Vibro Yoga assets

**Template usage:** Use Cloudinary filters/shortcodes in templates:
```nunjucks
{% cldimg "yoga-bible-DK/concepts/hotyoga/hero", "Hot Yoga studio", "w_800,h_600,c_fill", "800", "600" %}
```

## Required images

### Hero
- `hero-bg.jpg` (1920x900) — dark cinematic yoga atmosphere
- Cloudinary: `yoga-bible-DK/concepts/hero-bg`

### Hot Yoga CPH
- `hotyoga-hero.jpg` (800x600) → `yoga-bible-DK/concepts/hotyoga/hero`
- `hotyoga-infrared.jpg` (700x500) → `yoga-bible-DK/concepts/hotyoga/infrared`
- `hotyoga-frozen-towel.jpg` (600x340) → `yoga-bible-DK/concepts/hotyoga/frozen-towel`
- `hotyoga-sonic-shavasana.jpg` (600x340) → `yoga-bible-DK/concepts/hotyoga/sonic-shavasana`
- `hotyoga-ginger-shots.jpg` (600x340) → `yoga-bible-DK/concepts/hotyoga/ginger-shots`
- `hotyoga-herbal-tea.jpg` (600x340) → `yoga-bible-DK/concepts/hotyoga/herbal-tea`
- `hotyoga-premium.jpg` (600x340) → `yoga-bible-DK/concepts/hotyoga/premium`
- `hotyoga-music.jpg` (600x340) → `yoga-bible-DK/concepts/hotyoga/music`

### Namasté
- `namaste-hero.jpg` (800x600) → `yoga-bible-DK/concepts/namaste/hero`
- `namaste-studios-logo.png` (400x200) → `yoga-bible-DK/concepts/namaste/studios-logo`
- `namaste-online-logo.png` (400x200) → `yoga-bible-DK/concepts/namaste/online-logo`
- `namaste-class-1.jpg` (600x400) → `yoga-bible-DK/concepts/namaste/class-1`
- `namaste-class-2.jpg` (600x400) → `yoga-bible-DK/concepts/namaste/class-2`
- `namaste-class-3.jpg` (600x400) → `yoga-bible-DK/concepts/namaste/class-3`

### Vibro Yoga
- `vibro-hero.jpg` (800x600) → `yoga-bible-DK/concepts/vibro/hero`
- `vibro-studio-1.jpg` (600x400) → `yoga-bible-DK/concepts/vibro/studio-1`
- `vibro-session-1.jpg` (600x400) → `yoga-bible-DK/concepts/vibro/session-1`
- `vibro-shower-1.jpg` (600x400) → `yoga-bible-DK/concepts/vibro/shower-1`
