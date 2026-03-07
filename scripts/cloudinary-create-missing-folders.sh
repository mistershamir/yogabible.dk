#!/bin/bash
# ============================================================
# Create missing Cloudinary folders for yogabible.dk
# Run this locally where api.cloudinary.com is accessible
# ============================================================

API="https://api.cloudinary.com/v1_1/ddcynsa30/folders"
AUTH="617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"

echo "=== Creating missing Cloudinary folders ==="
echo ""

# ── Courses subfolders (referenced in templates but not in CLAUDE.md folder list) ──
echo "1. courses/backbends"
curl -s -X POST "$API/yoga-bible-DK/courses/backbends" -u "$AUTH" | python3 -m json.tool
echo ""

echo "2. courses/splits"
curl -s -X POST "$API/yoga-bible-DK/courses/splits" -u "$AUTH" | python3 -m json.tool
echo ""

# ── Program subfolders ──
echo "3. programs/om200"
curl -s -X POST "$API/yoga-bible-DK/programs/om200" -u "$AUTH" | python3 -m json.tool
echo ""

echo "4. programs/p8w"
curl -s -X POST "$API/yoga-bible-DK/programs/p8w" -u "$AUTH" | python3 -m json.tool
echo ""

echo "5. programs/p18w"
curl -s -X POST "$API/yoga-bible-DK/programs/p18w" -u "$AUTH" | python3 -m json.tool
echo ""

# ── Schedule pages (variant-specific hero/OG images) ──
echo "6. schedule-pages (parent)"
curl -s -X POST "$API/yoga-bible-DK/schedule-pages" -u "$AUTH" | python3 -m json.tool
echo ""

echo "7. schedule-pages/4w"
curl -s -X POST "$API/yoga-bible-DK/schedule-pages/4w" -u "$AUTH" | python3 -m json.tool
echo ""

echo "8. schedule-pages/8w"
curl -s -X POST "$API/yoga-bible-DK/schedule-pages/8w" -u "$AUTH" | python3 -m json.tool
echo ""

echo "9. schedule-pages/18w"
curl -s -X POST "$API/yoga-bible-DK/schedule-pages/18w" -u "$AUTH" | python3 -m json.tool
echo ""

echo "10. schedule-pages/4w-jul"
curl -s -X POST "$API/yoga-bible-DK/schedule-pages/4w-jul" -u "$AUTH" | python3 -m json.tool
echo ""

# ── Materials (used by doc-admin.js and cloudinary-browser function) ──
echo "11. materials"
curl -s -X POST "$API/yoga-bible-DK/materials" -u "$AUTH" | python3 -m json.tool
echo ""

# ── Tutorials ──
echo "12. tutorials (parent)"
curl -s -X POST "$API/yoga-bible-DK/tutorials" -u "$AUTH" | python3 -m json.tool
echo ""

echo "13. tutorials/homepage"
curl -s -X POST "$API/yoga-bible-DK/tutorials/homepage" -u "$AUTH" | python3 -m json.tool
echo ""

# ── Yoga Music page ──
echo "14. yogamusic"
curl -s -X POST "$API/yoga-bible-DK/yogamusic" -u "$AUTH" | python3 -m json.tool
echo ""

# ── Yoga Photography page ──
echo "15. yogaphotography"
curl -s -X POST "$API/yoga-bible-DK/yogaphotography" -u "$AUTH" | python3 -m json.tool
echo ""

echo "16. yogaphotography/models"
curl -s -X POST "$API/yoga-bible-DK/yogaphotography/models" -u "$AUTH" | python3 -m json.tool
echo ""

echo ""
echo "=== Done! All missing folders created. ==="
echo "Note: If a folder already exists, Cloudinary returns it without error."
