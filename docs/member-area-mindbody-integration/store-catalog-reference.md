# Store Catalog Reference — Product IDs & Pricing

> Complete reference for all products sold in the Yoga Bible store.
> Products are defined in `src/js/profile.js` → `storeCatalog` object.
> **Last updated: 2026-02-14**

## Age Bracket System

Pricing is split by age bracket:
- **Over 30:** Standard prices with 25% VAT
- **Under 30:** Reduced prices, VAT-exempt (0%)
- **Teacher Training:** Same price for all ages, VAT-exempt (education)
- **Courses:** Same price for all ages, VAT-exempt

Age bracket determined by `getAgeBracket()` using user's `dateOfBirth` vs 30-year threshold.

---

## 1. Clip Cards (Daily → Klippekort)

### Over 30 (25% VAT)

| Classes | Price | Per Class | VAT | Validity | Label DA | Label EN | prodId | Sharing |
|---------|-------|-----------|-----|----------|----------|----------|--------|---------|
| 1 | 299 kr | 299 kr | 60 kr | 10 days | Prøv En | Try One | `100174` | — |
| 2 | 549 kr | 274 kr | 110 kr | 30 days | Prøv Os | Try Us | `100175` | — |
| 3 | 799 kr | 266 kr | 160 kr | 30 days | Introduktion | Introduction | `100176` | — |
| 5 | 1.199 kr | 239 kr | 240 kr | 60 days | Fleksibel Start | Flexible Start | `100177` | — |
| 10 | 1.999 kr | 199 kr | 400 kr | 90 days | Spar Mere | Save More | `100178` | — |
| 20 | 3.499 kr | 174 kr | 700 kr | 6 months | Dedikeret | Dedicated | `100179` | — |
| 30 | 4.499 kr | 149 kr | 900 kr | 6 months | Seriøs Praksis | Serious Practice | `100180` | — |
| 60 | 7.499 kr | 124 kr | 1.500 kr | 12 months | Partnerkort | Partner Card | `100181` | 2 persons (3 total) |
| 100 | 9.999 kr | 99 kr | 2.000 kr | 18 months | Fællesskab | Community | `100182` | 3 persons (4 total) |
| 200 | 17.999 kr | 89 kr | 3.600 kr | 18 months | Familieplan | Family Plan | `100183` | 3 persons (4 total) |

### Under 30 (VAT-exempt)

| Classes | Price | Per Class | Validity | prodId |
|---------|-------|-----------|----------|--------|
| 1 | 239 kr | 239 kr | 10 days | `100174` |
| 2 | 439 kr | 219 kr | 30 days | `100175` |
| 3 | 639 kr | 213 kr | 30 days | `100176` |
| 5 | 959 kr | 191 kr | 60 days | `100177` |
| 10 | 1.599 kr | 159 kr | 90 days | `100178` |
| 20 | 2.799 kr | 139 kr | 6 months | `100179` |
| 30 | 3.599 kr | 119 kr | 6 months | `100180` |
| 60 | 5.999 kr | 99 kr | 12 months | `100181` |
| 100 | 7.999 kr | 79 kr | 18 months | `100182` |
| 200 | 14.399 kr | 71 kr | 18 months | `100183` |

---

## 2. Memberships (Daily → Medlemskab) — Contracts

All memberships are recurring monthly contracts (`_itemType: 'contract'`).

### Over 30

| Tier | Price/mo | Per Class | Reg Fee | First Month Free | Popular | prodId |
|------|----------|-----------|---------|-----------------|---------|--------|
| 10 Classes/Month | 999 kr | 99 kr | 299 kr | Yes | **Yes** | `101` |
| Unlimited/Month | 1.249 kr | ~41 kr | 299 kr | Yes | No | `104` |
| Premium Unlimited | 1.499 kr | (all included) | 299 kr | Yes | No | `103` |

**Premium features:** Up to 30 classes/week, Guest Pass/month, 10% Retail Discount, Priority Waitlist, Exclusive Member Events

### Under 30

| Tier | Price/mo | Per Class | Reg Fee | First Month Free | Popular | prodId |
|------|----------|-----------|---------|-----------------|---------|--------|
| 10 Classes/Month | 799 kr | 79 kr | 275 kr | Yes | **Yes** | `101` |
| Unlimited/Month | 999 kr | ~33 kr | 275 kr | Yes | No | `104` |
| Premium Unlimited | 1.199 kr | (all included) | 275 kr | Yes | No | `103` |

---

## 3. Time-based Passes (Daily → Tidsbegrænsede pas)

### Over 30

| Duration | Price | Per Month | Validity | Popular | Best Deal | prodId | Savings |
|----------|-------|-----------|----------|---------|-----------|--------|---------|
| 14 Days | 799 kr | — | 14 days | No | No | `100186` | — |
| 21 Days | 999 kr | — | 21 days | No | No | `100187` | — |
| 1 Month | 1.499 kr | 1.499 kr | 30 days | No | No | `100188` | — |
| 3 Months | 3.999 kr | 1.333 kr | 90 days | **Yes** | No | `100189` | Save 497 kr |
| 6 Months | 6.999 kr | 1.166 kr | 180 days | No | No | `100190` | Save 1.494 kr |
| 12+1 Months | 9.599 kr | 738 kr | 13 months | No | **Yes** | `100191` | Save 2.664 kr |

### Under 30

| Duration | Price | Validity | prodId |
|----------|-------|----------|--------|
| 14 Days | 639 kr | 14 days | `100192` |
| 21 Days | 799 kr | 21 days | `100193` |
| 1 Month | 1.199 kr | 30 days | `100194` |
| 3 Months | 3.199 kr | 90 days | `100195` |
| 6 Months | 5.599 kr | 180 days | `100196` |
| 12+1 Months | 7.679 kr | 13 months | `100197` |

---

## 4. Trial Passes (Daily → Prøvekort)

| Name | Source | Notes |
|------|--------|-------|
| Single Class | refs clips[0] | Same as 1-class clip card |
| 14 Days | refs timebased[0] | Same as 14-day pass |
| 21 Days | refs timebased[1] | Same as 21-day pass |
| KickStarter | Standalone | CPH only, 10 classes in 3 weeks |

KickStarter: Over 30 = 599 kr (prodId `100185`), Under 30 = 475 kr (prodId `100185`)

---

## 5. Tourist Pass (Daily → Turistpas)

Over 30: 7 Days Unlimited, 895 kr, incl. mat + 2 towels (prodId `100199`)
Under 30: 7 Days Unlimited, 750 kr, incl. mat + 2 towels (prodId `100051`)

Rental note: Mat 40 kr, Practice towel 40 kr, Shower towel 40 kr (pay at studio)

---

## 6. Teacher Training Deposits (Yogalæreruddannelse)

All deposits are **3,750 kr**, VAT-exempt (education). Same price regardless of age.

| Program | Period | Format | prodId |
|---------|--------|--------|--------|
| 18-Week Flexible | March – June 2026 | 200-hour complete | `100078` |
| 4-Week Intensive | April 2026 | 200-hour complete | `100121` |
| 4-Week Intensive | July 2026 | 200-hour complete | `100211` |
| 8-Week Semi-Intensive | May – June 2026 | 200-hour complete | `100209` |
| 18-Week Flexible | August – December 2026 | 200-hour complete | `100210` |

**Deposit benefits:**
- Secure your spot in the program
- Start booking classes immediately (even before training begins)
- Classes count toward training hour requirements
- Prepare body and mind, join the community early
- Save on separate membership — deposit provides class access

---

## 7. Courses (Kurser) — Course Builder

### Individual Courses

| Course | Price | prodId | Read More |
|--------|-------|--------|-----------|
| Inversions | 2,300 kr | `100145` | `/inversions` |
| Splits | 2,300 kr | `100150` | `/splits` |
| Backbends | 2,300 kr | `100140` | `/backbends` |

### Bundle Discounts

| Bundle | Discount | Price | prodId |
|--------|----------|-------|--------|
| Any 2 courses | 10% off | 4,140 kr | varies (see below) |
| All 3 courses (All-In) | 15% off + FREE 30-day pass | 5,865 kr | `127` |

### 2-Course Bundle prodIds

| Combination | prodId |
|-------------|--------|
| Inversions + Backbends | `119` |
| Inversions + Splits | `120` |
| Backbends + Splits | `121` |

### Bundle Bonus (3 courses)
- FREE 30-day unlimited studio pass (value 1,249 kr)
- Includes: Hot Yoga, Non-heated, Vibro Yoga — up to 30 classes/week

### Bundle Key Mapping (in JS)
Bundle keys are sorted alphabetically, pipe-separated:
```javascript
bundles: {
  'backbends|inversions': { prodId: '119' },
  'inversions|splits': { prodId: '120' },
  'backbends|splits': { prodId: '121' },
  'backbends|inversions|splits': { prodId: '127' }
}
```

---

## 8. Test Items (Development Only)

| Name | Price | Type | prodId |
|------|-------|------|--------|
| Test Clip Card | 1 kr | Service | `100203` |
| Test Membership | 1 kr | Contract | `129` |

---

## Store Navigation Structure

```
Store (Butik)
├── Daily Classes (Daglige Klasser)
│   ├── Memberships (Medlemskab) — 3 contract tiers
│   ├── Time-based (Tidsbegrænsede) — 6 duration options
│   ├── Clip Cards (Klippekort) — 10 size options
│   ├── Trial Passes (Prøvekort) — 4 options
│   ├── Tourist Pass (Turistpas) — 1 option
│   └── Test — 2 dev items
├── Teacher Training (Yogalæreruddannelse)
│   └── 5 deposit cards (info banner + standard card grid)
├── Courses (Kurser)
│   └── Course Builder UI (toggle selection + live pricing)
└── Private Classes (Privattimer)
    └── Coming soon (toast notification)
```

## Checkout Routing

| Item Type | Endpoint | MB API |
|-----------|----------|--------|
| Service (clips, passes, courses, deposits) | `mb-checkout` | `/sale/cartcheckout` |
| Contract (memberships) | `mb-contracts` | `/sale/purchasecontract` |

## Adding New Products

1. Add item to `storeCatalog` in `src/js/profile.js`
2. Add build logic in `buildStoreFromCatalog()` if new category
3. If new top-level category: add to `storeTopCategories` array
4. If custom rendering needed: add section in `renderStoreItems()` and/or `renderStoreCardGrid()`
5. Build and verify: `npx @11ty/eleventy`
6. If product exists in Mindbody: use correct prodId. If not: create in Mindbody first
