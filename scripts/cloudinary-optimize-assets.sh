#!/bin/bash
# ============================================================
# Cloudinary Asset Optimizer — yogabible.dk
# Re-uploads oversized originals with optimized transforms.
# Uses Cloudinary's "upload from URL" to replace originals.
# ============================================================

CLOUD="ddcynsa30"
UPLOAD_API="https://api.cloudinary.com/v1_1/$CLOUD/image/upload"
AUTH="617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"
CDN="https://res.cloudinary.com/$CLOUD/image/upload"

optimized=0
failed=0

optimize_image() {
  local public_id="$1"
  local transforms="$2"
  local label="$3"

  echo "  → $label"
  echo "    ID: $public_id"
  echo "    Transforms: $transforms"

  result=$(curl -s -X POST "$UPLOAD_API" \
    -u "$AUTH" \
    -d "file=${CDN}/${transforms}/${public_id}" \
    -d "public_id=${public_id}" \
    -d "overwrite=true" \
    -d "invalidate=true")

  # Check result
  bytes=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('bytes',0))" 2>/dev/null)
  error=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('message',''))" 2>/dev/null)

  if [ -n "$error" ] && [ "$error" != "" ]; then
    echo "    ✗ FAILED: $error"
    ((failed++))
  elif [ "$bytes" -gt 0 ] 2>/dev/null; then
    mb=$(echo "scale=1; $bytes / 1048576" | bc)
    echo "    ✓ Done — new size: ${mb}MB"
    ((optimized++))
  else
    echo "    ? Unknown result"
    ((failed++))
  fi
  echo ""
}

echo "=========================================="
echo "  Cloudinary Asset Optimizer"
echo "=========================================="
echo ""

# ── 1. Oversized JPG photos (resize to max 2400px wide, quality 85) ──
echo "── Step 1: Resize oversized JPG photos ──"
echo "(Max 2400px wide, quality 85, auto format)"
echo ""

optimize_image \
  "yoga-bible-DK/studio/studio-torvegade" \
  "w_2400,c_limit,q_85,f_jpg" \
  "Studio Torvegade (7.2MB, 4240x2832)"

optimize_image \
  "yoga-bible-DK/studio/studio-shower" \
  "w_2400,c_limit,q_85,f_jpg" \
  "Studio Shower (6.8MB, 4240x2832)"

optimize_image \
  "yoga-bible-DK/mentorship/beth-02" \
  "w_2400,c_limit,q_85,f_jpg" \
  "Beth Mentorship (5.7MB, 3833x4627)"

optimize_image \
  "yoga-bible-DK/mentorship/mentor-private-inversions" \
  "w_2400,c_limit,q_85,f_jpg" \
  "Mentor Inversions (3.7MB, 4480x6720)"

optimize_image \
  "yoga-bible-DK/copenhagen/metro-station-01" \
  "w_2400,c_limit,q_85,f_jpg" \
  "Metro Station 01 (3.3MB, 4032x3024)"

optimize_image \
  "yoga-bible-DK/copenhagen/metro-station-02" \
  "w_2400,c_limit,q_85,f_jpg" \
  "Metro Station 02 (2.6MB, 4032x3024)"

# ── 2. PNG → JPG conversion (these are photos, not graphics with transparency) ──
echo "── Step 2: Convert PNG photos to JPG ──"
echo "(Photos stored as PNG waste space — converting to JPG)"
echo ""

optimize_image \
  "yoga-bible-DK/studio/studio-hot-yoga-01" \
  "w_2000,c_limit,q_85,f_jpg" \
  "Studio Hot Yoga (4.0MB PNG, 2000x1336)"

optimize_image \
  "yoga-bible-DK/studio/studio-training-space" \
  "w_2000,c_limit,q_85,f_jpg" \
  "Studio Training Space (3.5MB PNG, 2000x1336)"

optimize_image \
  "yoga-bible-DK/programs/ytt-200h-education" \
  "w_1600,c_limit,q_85,f_jpg" \
  "YTT 200h Education (1.6MB PNG)"

optimize_image \
  "yoga-bible-DK/courses/inversions-course-copenhagen-promo" \
  "w_1200,c_limit,q_85,f_jpg" \
  "Inversions Promo (0.6MB PNG)"

# ── 3. Oversized brand/icon PNGs (keep PNG but resize) ──
echo "── Step 3: Resize oversized brand PNGs ──"
echo "(Keep PNG format for logos/icons, but reduce dimensions)"
echo ""

optimize_image \
  "yoga-bible-DK/brand/instagram-glyph" \
  "w_512,c_limit,q_90,f_png" \
  "Instagram Glyph (2.5MB PNG, 5000x5000 → 512x512)"

# ── Summary ──
echo "=========================================="
echo "  Optimization complete!"
echo "  ✓ Optimized: $optimized"
echo "  ✗ Failed: $failed"
echo ""
echo "  NOTE: Videos were not optimized."
echo "  Video optimization requires re-encoding"
echo "  which Cloudinary handles on delivery via"
echo "  f_auto,q_auto transforms in your templates."
echo "=========================================="
