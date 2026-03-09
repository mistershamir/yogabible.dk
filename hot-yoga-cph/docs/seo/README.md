# Hot Yoga Copenhagen — SEO & AEO Improvement Kit

This folder contains ready-to-use structured data, audit findings, and implementation guides for improving Hot Yoga Copenhagen's search visibility across both traditional search engines (Google, Bing) and AI answer engines (ChatGPT, Perplexity, Google AI Overviews).

## Contents

| File | Purpose | Where to Use |
|------|---------|--------------|
| `schema-homepage.json` | JSON-LD for the homepage | Framer → Homepage → Page Settings → Custom Code → Start of `<head>` |
| `schema-classes.json` | JSON-LD for the classes/book page | Framer → Book a Class page → Page Settings → Custom Code |
| `schema-pricing.json` | JSON-LD for the pricing page | Framer → Pricing page → Page Settings → Custom Code |
| `schema-teacher-training.json` | JSON-LD for YTT pages | Framer → Teacher Training page → Page Settings → Custom Code |
| `schema-faq.json` | FAQPage schema (AEO gold) | Framer → FAQ page (create one!) → Page Settings → Custom Code |
| `framer-seo-checklist.md` | Page-by-page SEO checklist for Framer | Manual implementation guide |
| `aeo-action-plan.md` | Full AEO strategy and action plan | Strategy document |

## How to Add JSON-LD to Framer

1. Open your Framer project
2. Select the **specific page** (NOT site settings)
3. Click the **Settings icon** (gear) in the top toolbar
4. Scroll to **Custom Code** → click **"Show Advanced"**
5. Paste the JSON-LD `<script>` tag into **"Start of `<head>` tag"**
6. **Publish** the site
7. Validate at https://search.google.com/test/rich-results using the live URL

**IMPORTANT:** Each schema goes on its specific page only — never in global Site Settings.

## Validation Tools

- [Google Rich Results Test](https://search.google.com/test/rich-results)
- [Schema.org Validator](https://validator.schema.org/)
- [Google Search Console](https://search.google.com/search-console)
