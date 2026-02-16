# Journal Assets

This folder contains media for Yoga Journal blog posts.

**Cloudinary folder:** `yoga-bible-DK/journal/`

**Template usage:** Use Cloudinary filters in journal entries:
```nunjucks
{{ "yoga-bible-DK/journal/post-slug" | cloudimg("w_1200,h_630,c_fill") }}
```

## Structure

```
journal/
├── vinyasa-yoga.jpg          ← named after post slug
├── breathing-techniques.jpg
├── chakras.jpg
└── ...
```

**Cloudinary equivalent:**
```
yoga-bible-DK/journal/
├── vinyasa-yoga              ← same slug, no extension needed
├── breathing-techniques
├── chakras
└── ...
```

## Guidelines

- **Naming:** Use the post slug as filename (e.g., `hvad-er-vinyasa-yoga.jpg`)
- **Cloudinary path:** `yoga-bible-DK/journal/{post-slug}` (no file extension)
- **Format:** JPEG for photos, PNG for graphics, WebP preferred when possible
- **Size:** Aim for 1200x630px (matches OG image ratio) for hero images
- **Thumbnails:** Not needed — CSS handles responsive sizing, Cloudinary handles transforms
- **Videos:** Place in `/assets/videos/journal/` using same slug naming
- **Cloudinary videos:** Upload to `yoga-bible-DK/journal/{post-slug}-video`
