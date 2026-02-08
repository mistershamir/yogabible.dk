# Member Area / Mindbody Integration — Multi Brand

> Reusable reference for building member areas on Yoga Bible DK, Hot Yoga CPH, and future brand sites.
> All brands share the same Mindbody Site ID (5748831) and Firebase project (yoga-bible-dk-com).

## Quick Start for New Brand

1. Copy all `netlify/functions/mb-*.js` and `netlify/functions/shared/` to the new project
2. Copy `src/js/profile.js` as a starting point for the member area JS
3. Set up Firebase Auth + Firestore (or connect to existing project)
4. Configure Netlify env vars (see Environment Setup below)
5. Adapt the profile template and translations for the new brand

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Browser (JS)   │────▶│ Netlify Functions │────▶│  Mindbody API   │
│  firebase-auth  │     │   mb-*.js         │     │  v6 (REST)      │
│  profile.js     │     │   shared/mb-api   │     │  Staff Token    │
└────────┬────────┘     └──────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Firebase/       │
│  Firestore       │
│  users/{uid}     │
└─────────────────┘
```

## Environment Variables (Netlify)

```
MB_API_KEY=<your-mindbody-api-key>
MB_SITE_ID=5748831
MB_STAFF_USERNAME=<staff-username>
MB_STAFF_PASSWORD=<staff-password>
```

## See Also

- [API Reference & Debug Trail](./api-reference.md) — ALL the lessons learned
- [Function Catalog](./function-catalog.md) — Every Netlify function with usage
- [Profile JS Architecture](./profile-architecture.md) — How the frontend works
