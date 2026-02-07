# Master Orchestrator Prompt

> Copy-paste this as your FIRST message in the Yoga Bible Data project chat.

---

I'm building a comprehensive bilingual yoga glossary for yogabible.dk (Danish primary, English). The data lives in JSON files on GitHub. I need to enrich all categories with missing metadata fields.

## Current State

The glossary has 10 categories. **Asanas (~180 poses) are already complete — don't touch those.** The other 9 categories have basic data (name, description, subcategory) but are missing rich metadata that would make the glossary truly useful for yoga teachers.

**Repository:** `mistershamir/yogabible.dk`
**Branch:** `main` (after merge)
**Data path:** `src/_data/glossary/`

Fetch any category file via:
```
https://raw.githubusercontent.com/mistershamir/yogabible.dk/main/src/_data/glossary/{filename}.json
```

## What I Need You to Do

I'll work through categories one at a time. For each category:

1. **Fetch the current JSON** from the GitHub raw URL
2. **Show me what each entry currently has vs what's missing** per the project instructions
3. **Enrich every entry** by adding the missing fields
4. **Suggest 2-5 new terms** that should be added (with justification)
5. **Output the complete JSON** — ready to replace the file

## Priority Order

Work through these in order (highest impact first):

| # | Category | File | Terms | Fields to Add |
|---|---|---|---|---|
| 1 | **Breathing** | `breathing.json` | 15 | pronunciation, tags, related, level, effect, instructions_da/en, contraindications_da/en, duration |
| 2 | **Energy** | `energy.json` | 22 | pronunciation, tags, related, location_da/en, element, color, mantra |
| 3 | **Meditation** | `meditation.json` | 12 | pronunciation, tags, related, level, instructions_da/en, duration |
| 4 | **Styles** | `styles.json` | 15 | pronunciation, tags, related, intensity, focus, founder, student_level |
| 5 | **Philosophy** | `philosophy.json` | 23 | pronunciation, tags, related, source |
| 6 | **Teaching** | `teaching.json` | 10 | tags, related, level, tips_da/en |
| 7 | **Anatomy** | `anatomy.json` | 12 | pronunciation, tags, related, body_areas, related_poses |
| 8 | **Equipment** | `equipment.json` | 8 | tags, related, materials, related_styles |
| 9 | **Business** | `business.json` | 7 | tags, related |

## Rules

- **Danish is primary** — write it naturally, not as a translation
- **Omit fields** rather than setting null when they don't apply
- **Don't modify existing values** — only ADD new fields to existing entries
- **Tags:** lowercase, hyphenated, 3-5 per term
- **Related:** use exact `sanskrit` field values from the glossary for cross-linking
- **Pronunciation:** format as `"(pron-here)"`, only for Sanskrit terms
- **Output:** complete valid JSON array, pretty-printed, ready to replace the file

## Let's Start

Please fetch `breathing.json` from the GitHub URL above. Analyze what's there, show me the gaps, then give me the fully enriched JSON with all missing fields added. Also suggest any terms that should be added to make this category more complete.
