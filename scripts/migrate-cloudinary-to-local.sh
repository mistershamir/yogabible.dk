#!/bin/bash
# ============================================================
# Migrate ALL Cloudinary Assets to Local
# Downloads images → src/assets/images/
# Downloads videos → src/assets/videos/
# Poster frames → src/assets/images/ (extracted from video thumbnails)
#
# Once all assets are local, Cloudinary can be cancelled entirely.
# Netlify CDN serves everything via static file hosting.
#
# Run from project root:
#   bash scripts/migrate-cloudinary-to-local.sh
#
# Options:
#   --dry-run    Show what would be downloaded without downloading
#   --audit      Show file sizes and flag oversized files
#   --force      Re-download even if local file exists
#   --images     Only download images
#   --videos     Only download videos
# ============================================================

set -euo pipefail

CLOUD="ddcynsa30"
API="https://api.cloudinary.com/v1_1/$CLOUD"
AUTH="617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"
IMG_DIR="src/assets/images"
VID_DIR="src/assets/videos"
CLOUD_BASE="https://res.cloudinary.com/$CLOUD"

DRY_RUN=false
AUDIT=false
FORCE=false
DO_IMAGES=true
DO_VIDEOS=true

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --audit) AUDIT=true ;;
    --force) FORCE=true ;;
    --images) DO_VIDEOS=false ;;
    --videos) DO_IMAGES=false ;;
  esac
done

echo "=========================================="
echo "  Cloudinary → Local Migration"
echo "  Images → $IMG_DIR/"
echo "  Videos → $VID_DIR/"
echo "=========================================="
echo ""

# ── Generic fetch function ──
fetch_resources() {
  local RESOURCE_TYPE="$1"
  local ALL_DATA=""
  local CURSOR=""
  local PAGE=1

  echo "Fetching $RESOURCE_TYPE inventory from Cloudinary..."

  while true; do
    CURSOR_PARAM=""
    if [ -n "$CURSOR" ]; then
      CURSOR_PARAM="&next_cursor=$CURSOR"
    fi

    RESPONSE=$(curl -s "$API/resources/$RESOURCE_TYPE?prefix=yoga-bible-DK/&max_results=500&type=upload${CURSOR_PARAM}" \
      -u "$AUTH" 2>/dev/null || echo '{"resources":[]}')

    PAGE_DATA=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
except:
    data = {'resources': []}
resources = data.get('resources', [])
for r in resources:
    fmt = r.get('format', '')
    size = r.get('bytes', 0)
    w = r.get('width', 0)
    h = r.get('height', 0)
    pid = r['public_id']
    print(f'{pid}|{fmt}|{size}|{w}|{h}')
cursor = data.get('next_cursor', '')
print(f'CURSOR:{cursor}')
")

    CURSOR=$(echo "$PAGE_DATA" | grep '^CURSOR:' | sed 's/^CURSOR://')
    ALL_DATA="$ALL_DATA
$(echo "$PAGE_DATA" | grep -v '^CURSOR:')"

    echo "  Page $PAGE fetched..."
    PAGE=$((PAGE + 1))

    if [ -z "$CURSOR" ]; then
      break
    fi
  done

  echo "$ALL_DATA" | sed '/^$/d'
}

# ── Download a single image ──
download_image() {
  local pid="$1" fmt="$2" size="$3" w="$4" h="$5"

  LOCAL_REL=$(echo "$pid" | sed 's|^yoga-bible-DK/||')
  EXT="$fmt"
  if [ "$EXT" = "jpeg" ]; then EXT="jpg"; fi

  LOCAL_PATH="$IMG_DIR/$LOCAL_REL.$EXT"
  LOCAL_DIR=$(dirname "$LOCAL_PATH")

  if [ -f "$LOCAL_PATH" ] && [ "$FORCE" != true ]; then
    return 1  # skipped
  fi

  if [ "$DRY_RUN" = true ]; then
    local mb; mb=$(echo "scale=2; $size / 1048576" | bc)
    echo "  [DRY] $LOCAL_REL.$EXT (${mb}MB, ${w}x${h})"
    return 0
  fi

  mkdir -p "$LOCAL_DIR"

  # Optimize on download: scale >1920px, convert large PNGs to JPEG
  TRANSFORM="f_auto,q_85"
  if (( w > 1920 )); then
    TRANSFORM="w_1920,c_scale,$TRANSFORM"
  fi
  if [ "$fmt" = "png" ] && (( size > 524288 )) && (( w > 400 )) && (( h > 400 )); then
    EXT="jpg"
    LOCAL_PATH="$IMG_DIR/$LOCAL_REL.jpg"
    TRANSFORM="$TRANSFORM,f_jpg"
  fi

  DOWNLOAD_URL="$CLOUD_BASE/image/upload/$TRANSFORM/$pid"
  HTTP_CODE=$(curl -s -o "$LOCAL_PATH" -w "%{http_code}" "$DOWNLOAD_URL")

  if [ "$HTTP_CODE" = "200" ]; then
    FILE_SIZE=$(stat -f%z "$LOCAL_PATH" 2>/dev/null || stat -c%s "$LOCAL_PATH" 2>/dev/null)
    local mb; mb=$(echo "scale=2; $FILE_SIZE / 1048576" | bc)
    echo "  ✓ ${mb}MB | $LOCAL_REL.$EXT"
    return 0
  else
    echo "  ✗ FAILED ($HTTP_CODE) | $pid"
    rm -f "$LOCAL_PATH"
    return 2
  fi
}

# ── Download a single video ──
download_video() {
  local pid="$1" fmt="$2" size="$3"

  LOCAL_REL=$(echo "$pid" | sed 's|^yoga-bible-DK/||')
  EXT="$fmt"
  if [ -z "$EXT" ]; then EXT="mp4"; fi

  LOCAL_PATH="$VID_DIR/$LOCAL_REL.$EXT"
  LOCAL_DIR=$(dirname "$LOCAL_PATH")

  if [ -f "$LOCAL_PATH" ] && [ "$FORCE" != true ]; then
    return 1  # skipped
  fi

  if [ "$DRY_RUN" = true ]; then
    local mb; mb=$(echo "scale=2; $size / 1048576" | bc)
    echo "  [DRY] $LOCAL_REL.$EXT (${mb}MB)"
    return 0
  fi

  mkdir -p "$LOCAL_DIR"

  # Download original video (no transforms — keep source quality)
  DOWNLOAD_URL="$CLOUD_BASE/video/upload/$pid.$EXT"
  HTTP_CODE=$(curl -s -L -o "$LOCAL_PATH" -w "%{http_code}" "$DOWNLOAD_URL")

  if [ "$HTTP_CODE" = "200" ]; then
    FILE_SIZE=$(stat -f%z "$LOCAL_PATH" 2>/dev/null || stat -c%s "$LOCAL_PATH" 2>/dev/null)
    local mb; mb=$(echo "scale=2; $FILE_SIZE / 1048576" | bc)
    echo "  ✓ ${mb}MB | $LOCAL_REL.$EXT"
    return 0
  else
    echo "  ✗ FAILED ($HTTP_CODE) | $pid.$EXT"
    rm -f "$LOCAL_PATH"
    return 2
  fi
}

# ── Counters ──
IMG_DOWNLOADED=0
IMG_SKIPPED=0
IMG_FAILED=0
VID_DOWNLOADED=0
VID_SKIPPED=0
VID_FAILED=0

# ── Images ──
if [ "$DO_IMAGES" = true ]; then
  ALL_IMAGES=$(fetch_resources "image")
  IMG_TOTAL=$(echo "$ALL_IMAGES" | wc -l | tr -d ' ')
  echo "Found $IMG_TOTAL images."
  echo ""

  if [ "$AUDIT" = true ]; then
    echo "── IMAGE AUDIT ──"
    echo ""
    echo "RED: Oversized (>2MB or >3000px):"
    echo "$ALL_IMAGES" | while IFS='|' read -r pid fmt size w h; do
      local mb; mb=$(echo "scale=2; $size / 1048576" | bc)
      if (( size > 2097152 )) || (( w > 3000 )); then
        echo "  ✗ ${mb}MB | ${w}x${h} | $fmt | $pid"
      fi
    done
    echo ""
    echo "YELLOW: Large (1-2MB or 2000-3000px):"
    echo "$ALL_IMAGES" | while IFS='|' read -r pid fmt size w h; do
      local mb; mb=$(echo "scale=2; $size / 1048576" | bc)
      if (( size > 1048576 && size <= 2097152 )) || (( w > 2000 && w <= 3000 )); then
        echo "  ⚠ ${mb}MB | ${w}x${h} | $fmt | $pid"
      fi
    done
    echo ""
  else
    echo "=== Downloading Images to $IMG_DIR/ ==="
    echo "$ALL_IMAGES" | while IFS='|' read -r pid fmt size w h; do
      [ -z "$pid" ] && continue
      download_image "$pid" "$fmt" "$size" "$w" "$h"
      case $? in
        0) IMG_DOWNLOADED=$((IMG_DOWNLOADED + 1)) ;;
        1) IMG_SKIPPED=$((IMG_SKIPPED + 1)) ;;
        2) IMG_FAILED=$((IMG_FAILED + 1)) ;;
      esac
    done
    echo ""
  fi
fi

# ── Videos ──
if [ "$DO_VIDEOS" = true ]; then
  ALL_VIDEOS=$(fetch_resources "video")
  VID_TOTAL=$(echo "$ALL_VIDEOS" | wc -l | tr -d ' ')
  echo "Found $VID_TOTAL videos."
  echo ""

  if [ "$AUDIT" = true ]; then
    echo "── VIDEO AUDIT ──"
    echo ""
    echo "$ALL_VIDEOS" | while IFS='|' read -r pid fmt size w h; do
      local mb; mb=$(echo "scale=2; $size / 1048576" | bc)
      echo "  ${mb}MB | ${w}x${h} | $fmt | $pid"
    done
    echo ""
  else
    echo "=== Downloading Videos to $VID_DIR/ ==="
    echo "$ALL_VIDEOS" | while IFS='|' read -r pid fmt size w h; do
      [ -z "$pid" ] && continue
      download_video "$pid" "$fmt" "$size"
      case $? in
        0) VID_DOWNLOADED=$((VID_DOWNLOADED + 1)) ;;
        1) VID_SKIPPED=$((VID_SKIPPED + 1)) ;;
        2) VID_FAILED=$((VID_FAILED + 1)) ;;
      esac
    done
    echo ""

    # ── Root-level videos (not under yoga-bible-DK/ prefix) ──
    echo "=== Downloading Root-Level Videos ==="
    ROOT_VIDEOS=(
      "v1773250445/18_weeks_Hero_Compressed_ixxiz6|mp4"
      "v1773250556/4_weeks_hero_compressed_a5w707|mp4"
      "v1773250613/8_weeks_hero_compressed_zy0yup|mp4"
      "v1773146194/Backbends_Hero_Page_u1zuyt|mp4"
      "v1772623478/sonic-shavasana_pm0g4v|mp4"
      "v1772623479/frozen-towel_eyj4y8|mp4"
      "v1772623480/herbal-tea_j1t0yn|mp4"
    )
    for entry in "${ROOT_VIDEOS[@]}"; do
      IFS='|' read -r rpid rfmt <<< "$entry"
      # Strip version prefix for local path
      LOCAL_NAME=$(echo "$rpid" | sed 's|^v[0-9]*/||')
      LOCAL_PATH="$VID_DIR/$LOCAL_NAME.$rfmt"
      if [ -f "$LOCAL_PATH" ] && [ "$FORCE" != true ]; then
        continue
      fi
      if [ "$DRY_RUN" = true ]; then
        echo "  [DRY] $LOCAL_NAME.$rfmt"
        continue
      fi
      mkdir -p "$(dirname "$LOCAL_PATH")"
      DOWNLOAD_URL="$CLOUD_BASE/video/upload/$rpid.$rfmt"
      HTTP_CODE=$(curl -s -L -o "$LOCAL_PATH" -w "%{http_code}" "$DOWNLOAD_URL")
      if [ "$HTTP_CODE" = "200" ]; then
        FILE_SIZE=$(stat -f%z "$LOCAL_PATH" 2>/dev/null || stat -c%s "$LOCAL_PATH" 2>/dev/null)
        mb=$(echo "scale=2; $FILE_SIZE / 1048576" | bc)
        echo "  ✓ ${mb}MB | $LOCAL_NAME.$rfmt"
      else
        echo "  ✗ FAILED ($HTTP_CODE) | $rpid.$rfmt"
        rm -f "$LOCAL_PATH"
      fi
    done
    echo ""
  fi
fi

# ── Summary ──
if [ "$AUDIT" = true ]; then
  echo "=========================================="
  echo "  Run without --audit to start downloading"
  echo "=========================================="
else
  echo "=========================================="
  echo "  Migration Complete"
  echo "  Images:  downloaded=$IMG_DOWNLOADED  skipped=$IMG_SKIPPED  failed=$IMG_FAILED"
  echo "  Videos:  downloaded=$VID_DOWNLOADED  skipped=$VID_SKIPPED  failed=$VID_FAILED"
  echo "=========================================="
  echo ""
  echo "Local sizes:"
  du -sh "$IMG_DIR/" 2>/dev/null || echo "  $IMG_DIR/ (empty)"
  du -sh "$VID_DIR/" 2>/dev/null || echo "  $VID_DIR/ (empty)"
  echo ""
  echo "Next steps:"
  echo "  1. Build and verify: npx @11ty/eleventy"
  echo "  2. Commit and deploy — Netlify CDN serves everything"
  echo "  3. Cancel Cloudinary subscription"
fi
