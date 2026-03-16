#!/bin/bash
# ============================================================
# Migrate Cloudinary Images to Local
# Downloads all Cloudinary image assets to src/assets/images/
# preserving folder structure. Videos are skipped (stay on CDN).
#
# Run from project root:
#   bash scripts/migrate-cloudinary-to-local.sh
#
# Options:
#   --dry-run    Show what would be downloaded without downloading
#   --audit      Show file sizes and flag oversized files
#   --force      Re-download even if local file exists
# ============================================================

set -euo pipefail

CLOUD="ddcynsa30"
API="https://api.cloudinary.com/v1_1/$CLOUD"
AUTH="617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"
IMG_DIR="src/assets/images"
CLOUD_BASE="https://res.cloudinary.com/$CLOUD"

DRY_RUN=false
AUDIT=false
FORCE=false

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --audit) AUDIT=true ;;
    --force) FORCE=true ;;
  esac
done

echo "=========================================="
echo "  Cloudinary → Local Migration"
echo "=========================================="
echo ""

# ── Fetch all image assets ──
echo "Fetching image inventory from Cloudinary..."
ALL_IMAGES=""
CURSOR=""
PAGE=1

while true; do
  CURSOR_PARAM=""
  if [ -n "$CURSOR" ]; then
    CURSOR_PARAM="&next_cursor=$CURSOR"
  fi

  RESPONSE=$(curl -s "$API/resources/image?prefix=yoga-bible-DK/&max_results=500&type=upload${CURSOR_PARAM}" \
    -u "$AUTH")

  # Extract resources and append
  PAGE_DATA=$(echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
resources = data.get('resources', [])
for r in resources:
    fmt = r.get('format', 'jpg')
    size = r.get('bytes', 0)
    w = r.get('width', 0)
    h = r.get('height', 0)
    pid = r['public_id']
    print(f'{pid}|{fmt}|{size}|{w}|{h}')
cursor = data.get('next_cursor', '')
print(f'CURSOR:{cursor}')
")

  # Split cursor from data
  CURSOR=$(echo "$PAGE_DATA" | grep '^CURSOR:' | sed 's/^CURSOR://')
  ALL_IMAGES="$ALL_IMAGES
$(echo "$PAGE_DATA" | grep -v '^CURSOR:')"

  echo "  Page $PAGE fetched..."
  PAGE=$((PAGE + 1))

  if [ -z "$CURSOR" ]; then
    break
  fi
done

# Clean empty lines
ALL_IMAGES=$(echo "$ALL_IMAGES" | sed '/^$/d')
TOTAL=$(echo "$ALL_IMAGES" | wc -l | tr -d ' ')
echo ""
echo "Found $TOTAL image assets on Cloudinary."
echo ""

# ── Audit mode: show sizes and flag problems ──
if [ "$AUDIT" = true ]; then
  echo "=========================================="
  echo "  AUDIT REPORT"
  echo "=========================================="
  echo ""

  RED_COUNT=0
  YELLOW_COUNT=0
  GREEN_COUNT=0

  echo "── RED: Oversized (>2MB or >3000px) — YOU must optimize these before migration ──"
  echo "$ALL_IMAGES" | while IFS='|' read -r pid fmt size w h; do
    mb=$(echo "scale=2; $size / 1048576" | bc)
    if (( size > 2097152 )) || (( w > 3000 )); then
      echo "  ✗ ${mb}MB | ${w}x${h} | $fmt | $pid"
    fi
  done
  echo ""

  echo "── YELLOW: Large (1-2MB or 2000-3000px) — will work but consider optimizing ──"
  echo "$ALL_IMAGES" | while IFS='|' read -r pid fmt size w h; do
    mb=$(echo "scale=2; $size / 1048576" | bc)
    if (( size > 1048576 && size <= 2097152 )) || (( w > 2000 && w <= 3000 )); then
      if (( size <= 2097152 )) && (( w <= 3000 )); then
        echo "  ⚠ ${mb}MB | ${w}x${h} | $fmt | $pid"
      fi
    fi
  done
  echo ""

  echo "── GREEN: Good (<1MB and <2000px) — ready for migration ──"
  GREEN=$(echo "$ALL_IMAGES" | while IFS='|' read -r pid fmt size w h; do
    if (( size <= 1048576 )) && (( w <= 2000 )); then
      echo "ok"
    fi
  done | wc -l | tr -d ' ')
  echo "  $GREEN files are good to go."
  echo ""

  echo "── PNG photos (should be JPEG) ──"
  echo "$ALL_IMAGES" | while IFS='|' read -r pid fmt size w h; do
    mb=$(echo "scale=2; $size / 1048576" | bc)
    if [ "$fmt" = "png" ] && (( size > 524288 )); then
      echo "  ⚠ ${mb}MB | $pid.png — consider converting to JPEG"
    fi
  done
  echo ""

  echo "=========================================="
  echo "  Run without --audit to start downloading"
  echo "=========================================="
  exit 0
fi

# ── Download images ──
echo "Downloading images to $IMG_DIR/..."
echo ""

DOWNLOADED=0
SKIPPED=0
FAILED=0
FALLBACK=0

echo "$ALL_IMAGES" | while IFS='|' read -r pid fmt size w h; do
  # Map Cloudinary path to local path
  # yoga-bible-DK/brand/logo → brand/logo
  LOCAL_REL=$(echo "$pid" | sed 's|^yoga-bible-DK/||')

  # Determine extension
  EXT="$fmt"
  if [ "$EXT" = "jpeg" ]; then EXT="jpg"; fi

  LOCAL_PATH="$IMG_DIR/$LOCAL_REL.$EXT"
  LOCAL_DIR=$(dirname "$LOCAL_PATH")

  # Skip if already exists (unless --force)
  if [ -f "$LOCAL_PATH" ] && [ "$FORCE" != true ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "$DRY_RUN" = true ]; then
    mb=$(echo "scale=2; $size / 1048576" | bc)
    echo "  [DRY] Would download: $pid.$EXT (${mb}MB, ${w}x${h})"
    continue
  fi

  # Create directory
  mkdir -p "$LOCAL_DIR"

  # Download with optimization:
  # - Images >1920px wide: scale down to 1920px
  # - PNG photos >500KB: convert to JPEG
  # - Apply q_85 quality
  TRANSFORM="f_auto,q_85"

  if (( w > 1920 )); then
    TRANSFORM="w_1920,c_scale,$TRANSFORM"
  fi

  # For large PNGs that aren't brand assets, download as JPEG
  if [ "$fmt" = "png" ] && (( size > 524288 )); then
    # Check if it's likely a photo (not a logo/icon)
    if (( w > 400 )) && (( h > 400 )); then
      EXT="jpg"
      LOCAL_PATH="$IMG_DIR/$LOCAL_REL.jpg"
      TRANSFORM="$TRANSFORM,f_jpg"
    fi
  fi

  # Download from Cloudinary with transforms applied
  DOWNLOAD_URL="$CLOUD_BASE/image/upload/$TRANSFORM/$pid"
  HTTP_CODE=$(curl -s -o "$LOCAL_PATH" -w "%{http_code}" "$DOWNLOAD_URL")

  if [ "$HTTP_CODE" = "200" ]; then
    FILE_SIZE=$(stat -f%z "$LOCAL_PATH" 2>/dev/null || stat --printf="%s" "$LOCAL_PATH" 2>/dev/null)
    mb=$(echo "scale=2; $FILE_SIZE / 1048576" | bc)
    echo "  ✓ ${mb}MB | $LOCAL_REL.$EXT"
    DOWNLOADED=$((DOWNLOADED + 1))
  else
    echo "  ✗ FAILED ($HTTP_CODE) | $pid"
    rm -f "$LOCAL_PATH"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "=========================================="
echo "  Migration Complete"
echo "  Downloaded: $DOWNLOADED"
echo "  Skipped (already local): $SKIPPED"
echo "  Failed: $FAILED"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Run: bash scripts/migrate-cloudinary-to-local.sh --audit"
echo "     to check for oversized files that need manual optimization"
echo "  2. Run: npx @11ty/eleventy"
echo "     to verify the site builds with local images"
echo "  3. Commit and deploy"
echo ""
echo "Videos remain on Cloudinary CDN (no change needed)."
