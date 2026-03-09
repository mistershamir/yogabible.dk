#!/bin/bash
# ============================================================
# Cloudinary Asset Optimizer — yogabible.dk
# Dynamically finds oversized images (>1MB) and optimizes them.
# Requires: curl, python3
# ============================================================

CLOUD="ddcynsa30"
UPLOAD_API="https://api.cloudinary.com/v1_1/$CLOUD/image/upload"
SEARCH_API="https://api.cloudinary.com/v1_1/$CLOUD/resources/search"
AUTH="617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"
CDN="https://res.cloudinary.com/$CLOUD/image/upload"
TMPDIR=$(mktemp -d)

# Thresholds
MIN_BYTES=1048576    # 1MB — only optimize images larger than this
MAX_WIDTH=2400       # Max width for photos
QUALITY=85           # JPG quality
BRAND_MAX_WIDTH=512  # Max width for brand assets (icons, logos)

optimized=0
failed=0
skipped=0

optimize_image() {
  local public_id="$1"
  local width="$2"
  local orig_format="$3"
  local orig_bytes="$4"
  local orig_width="$5"
  local orig_height="$6"

  local orig_mb
  orig_mb=$(echo "scale=1; $orig_bytes / 1048576" | bc)

  # Determine output format: keep PNG for brand assets, convert photos to JPG
  local out_format="jpg"
  if [[ "$public_id" == *"/brand/"* ]]; then
    out_format="png"
    width=$BRAND_MAX_WIDTH
  fi

  echo "  → $public_id"
  echo "    Original: ${orig_mb}MB, ${orig_width}x${orig_height}, ${orig_format}"

  # Download optimized version via Cloudinary delivery URL
  local download_url="${CDN}/w_${width},c_limit,q_${QUALITY}/${public_id}.${out_format}"
  local tmpfile="${TMPDIR}/optimized.${out_format}"

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

  # Skip if optimized version isn't actually smaller
  if [ "$dl_size" -ge "$orig_bytes" ]; then
    echo "    ⊘ Already optimal (optimized would be same size or larger)"
    ((skipped++))
    echo ""
    return
  fi

  local dl_mb
  dl_mb=$(echo "scale=1; $dl_size / 1048576" | bc)
  local saved
  saved=$(echo "scale=0; ($orig_bytes - $dl_size) * 100 / $orig_bytes" | bc)
  echo "    Optimized: ${dl_mb}MB (${saved}% smaller)"

  # Re-upload the optimized file
  echo "    Uploading..."
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
    echo "    ✓ Replaced — new size: ${mb}MB"
    ((optimized++))
  else
    echo "    ? Unknown result"
    ((failed++))
  fi
  echo ""
}

echo "=========================================="
echo "  Cloudinary Asset Optimizer"
echo "  Scanning yoga-bible-DK/ for images >1MB"
echo "=========================================="
echo ""

# Search for all images in yoga-bible-DK/ that are over 1MB
# Cloudinary search API returns max 500 results per page
search_result=$(curl -s "$SEARCH_API" \
  -u "$AUTH" \
  -d "expression=public_id:yoga-bible-DK/* AND resource_type:image AND bytes>$MIN_BYTES" \
  -d "max_results=500")

total=$(echo "$search_result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total_count',0))" 2>/dev/null)
error_msg=$(echo "$search_result" | python3 -c "import sys,json; d=json.load(sys.stdin); e=d.get('error',{}); print(e.get('message',''))" 2>/dev/null)

if [ -n "$error_msg" ] && [ "$error_msg" != "" ] && [ "$error_msg" != "None" ]; then
  echo "  Search API error: $error_msg"
  echo ""
  rm -rf "$TMPDIR"
  exit 1
fi

if [ "$total" = "0" ] || [ -z "$total" ]; then
  echo "  No oversized images found (all images are under 1MB)."
  echo ""
  rm -rf "$TMPDIR"
  exit 0
fi

echo "  Found $total images over 1MB"
echo ""

# Parse results to a temp file, then loop (avoids subshell counter issue)
echo "$search_result" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data.get('resources', []):
    fmt = r.get('format', 'jpg')
    print(f\"{r['public_id']}|{r.get('width',0)}|{r.get('height',0)}|{r.get('bytes',0)}|{fmt}\")
" > "${TMPDIR}/assets.txt"

while IFS='|' read -r pub_id width height bytes fmt; do
  optimize_image "$pub_id" "$MAX_WIDTH" "$fmt" "$bytes" "$width" "$height"
done < "${TMPDIR}/assets.txt"

# ── Cleanup ──
rm -rf "$TMPDIR"

# ── Summary ──
echo "=========================================="
echo "  Optimization complete!"
echo "  ✓ Optimized: $optimized"
echo "  ⊘ Skipped (already optimal): $skipped"
echo "  ✗ Failed: $failed"
echo ""
echo "  Videos are optimized on delivery via"
echo "  f_auto,q_auto in your templates."
echo "=========================================="
