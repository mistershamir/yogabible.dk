#!/bin/bash
# ============================================================
# Cloudinary Asset Optimizer — yogabible.dk
# Downloads originals, applies transforms locally, re-uploads.
# Requires: curl, python3, sips (macOS built-in image tool)
# ============================================================

CLOUD="ddcynsa30"
UPLOAD_API="https://api.cloudinary.com/v1_1/$CLOUD/image/upload"
AUTH="617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"
CDN="https://res.cloudinary.com/$CLOUD/image/upload"
TMPDIR=$(mktemp -d)

optimized=0
failed=0

optimize_image() {
  local public_id="$1"
  local max_width="$2"
  local quality="$3"
  local out_format="$4"
  local label="$5"

  echo "  → $label"
  echo "    ID: $public_id"

  # Download original with transforms applied (delivery URL, not upload)
  local download_url="${CDN}/w_${max_width},c_limit,q_${quality}/${public_id}.${out_format}"
  local tmpfile="${TMPDIR}/optimized.${out_format}"

  echo "    Downloading optimized version..."
  local http_code
  http_code=$(curl -s -o "$tmpfile" -w "%{http_code}" "$download_url")

  if [ "$http_code" != "200" ]; then
    echo "    ✗ Download failed (HTTP $http_code)"
    ((failed++))
    echo ""
    return
  fi

  local dl_size
  dl_size=$(wc -c < "$tmpfile" | tr -d ' ')
  local dl_mb
  dl_mb=$(echo "scale=1; $dl_size / 1048576" | bc)
  echo "    Downloaded: ${dl_mb}MB"

  # Re-upload the optimized file
  echo "    Uploading optimized version..."
  local result
  result=$(curl -s -X POST "$UPLOAD_API" \
    -u "$AUTH" \
    -F "file=@${tmpfile}" \
    -F "public_id=${public_id}" \
    -F "overwrite=true" \
    -F "invalidate=true")

  local bytes error
  bytes=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('bytes',0))" 2>/dev/null)
  error=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); e=d.get('error',{}); print(e.get('message','') if e else '')" 2>/dev/null)

  if [ -n "$error" ] && [ "$error" != "" ] && [ "$error" != "None" ]; then
    echo "    ✗ Upload FAILED: $error"
    ((failed++))
  elif [ "$bytes" -gt 0 ] 2>/dev/null; then
    local mb
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
echo "  Temp dir: $TMPDIR"
echo ""

# ── 1. Oversized JPG photos (resize to max 2400px wide, quality 85) ──
echo "── Step 1: Resize oversized JPG photos ──"
echo ""

optimize_image "yoga-bible-DK/studio/studio-torvegade"              2400 85 jpg "Studio Torvegade (7.2MB, 4240x2832)"
optimize_image "yoga-bible-DK/studio/studio-shower"                 2400 85 jpg "Studio Shower (6.8MB, 4240x2832)"
optimize_image "yoga-bible-DK/mentorship/beth-02"                   2400 85 jpg "Beth Mentorship (5.7MB, 3833x4627)"
optimize_image "yoga-bible-DK/mentorship/mentor-private-inversions" 2400 85 jpg "Mentor Inversions (3.7MB, 4480x6720)"
optimize_image "yoga-bible-DK/copenhagen/metro-station-01"          2400 85 jpg "Metro Station 01 (3.3MB, 4032x3024)"
optimize_image "yoga-bible-DK/copenhagen/metro-station-02"          2400 85 jpg "Metro Station 02 (2.6MB, 4032x3024)"

# ── 2. PNG → JPG conversion (photos stored as PNG) ──
echo "── Step 2: Convert PNG photos to JPG ──"
echo ""

optimize_image "yoga-bible-DK/studio/studio-hot-yoga-01"                  2000 85 jpg "Studio Hot Yoga (4.0MB PNG)"
optimize_image "yoga-bible-DK/studio/studio-training-space"               2000 85 jpg "Studio Training Space (3.5MB PNG)"
optimize_image "yoga-bible-DK/programs/ytt-200h-education"                1600 85 jpg "YTT 200h Education (1.6MB PNG)"
optimize_image "yoga-bible-DK/courses/inversions-course-copenhagen-promo" 1200 85 jpg "Inversions Promo (0.6MB PNG)"

# ── 3. Oversized brand PNG (keep PNG, reduce size) ──
echo "── Step 3: Resize oversized brand PNG ──"
echo ""

optimize_image "yoga-bible-DK/brand/instagram-glyph" 512 90 png "Instagram Glyph (2.5MB, 5000x5000 → 512)"

# ── Cleanup ──
rm -rf "$TMPDIR"

# ── Summary ──
echo "=========================================="
echo "  Optimization complete!"
echo "  ✓ Optimized: $optimized"
echo "  ✗ Failed: $failed"
echo ""
echo "  Videos are optimized on delivery via"
echo "  f_auto,q_auto in your templates."
echo "=========================================="
