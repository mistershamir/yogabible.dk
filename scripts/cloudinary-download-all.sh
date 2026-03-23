#!/bin/bash
# ============================================================
# Download ALL Cloudinary Assets (images + videos + raw/PDFs)
# Run on Mac Mini while account is still active!
#
# Usage:
#   bash scripts/cloudinary-download-all.sh
#   bash scripts/cloudinary-download-all.sh --dry-run
#   bash scripts/cloudinary-download-all.sh --force
# ============================================================

set -euo pipefail

CLOUD="ddcynsa30"
API="https://api.cloudinary.com/v1_1/$CLOUD"
AUTH="617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"
CLOUD_BASE="https://res.cloudinary.com/$CLOUD"
OUTPUT_DIR="cloudinary-backup"

DRY_RUN=false
FORCE=false

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --force) FORCE=true ;;
  esac
done

echo "=========================================="
echo "  Cloudinary Full Backup"
echo "  Downloading ALL assets to ./$OUTPUT_DIR/"
echo "=========================================="
echo ""

mkdir -p "$OUTPUT_DIR"

# ── Generic function to fetch all resources of a given type ──
fetch_resources() {
  local RESOURCE_TYPE="$1"
  local ALL_DATA=""
  local CURSOR=""
  local PAGE=1

  echo "Fetching $RESOURCE_TYPE inventory..."

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
    url = r.get('secure_url', '')
    print(f'{pid}|{fmt}|{size}|{w}|{h}|{url}')
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

# ── Download a single file ──
download_file() {
  local PID="$1"
  local FMT="$2"
  local SIZE="$3"
  local URL="$4"
  local RESOURCE_TYPE="$5"

  # Map path
  local LOCAL_REL
  LOCAL_REL=$(echo "$PID" | sed 's|^yoga-bible-DK/||')

  # Determine extension
  local EXT="$FMT"
  if [ "$EXT" = "jpeg" ]; then EXT="jpg"; fi
  if [ -z "$EXT" ]; then EXT="bin"; fi

  local LOCAL_PATH="$OUTPUT_DIR/$LOCAL_REL.$EXT"
  local LOCAL_DIR
  LOCAL_DIR=$(dirname "$LOCAL_PATH")

  # Skip if exists
  if [ -f "$LOCAL_PATH" ] && [ "$FORCE" != true ]; then
    return 1  # skipped
  fi

  if [ "$DRY_RUN" = true ]; then
    local mb
    mb=$(echo "scale=2; $SIZE / 1048576" | bc)
    echo "  [DRY] $RESOURCE_TYPE | ${mb}MB | $LOCAL_REL.$EXT"
    return 0
  fi

  mkdir -p "$LOCAL_DIR"

  # For images: download original (no transforms — we want the source file)
  # For videos: download original
  # For raw: download original
  local DOWNLOAD_URL
  if [ "$RESOURCE_TYPE" = "image" ]; then
    # Download the original quality image
    DOWNLOAD_URL="$CLOUD_BASE/image/upload/$PID.$EXT"
  elif [ "$RESOURCE_TYPE" = "video" ]; then
    DOWNLOAD_URL="$CLOUD_BASE/video/upload/$PID.$EXT"
  else
    DOWNLOAD_URL="$CLOUD_BASE/raw/upload/$PID.$EXT"
  fi

  local HTTP_CODE
  HTTP_CODE=$(curl -s -L -o "$LOCAL_PATH" -w "%{http_code}" "$DOWNLOAD_URL" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ]; then
    local FILE_SIZE
    FILE_SIZE=$(stat -f%z "$LOCAL_PATH" 2>/dev/null || stat --printf="%s" "$LOCAL_PATH" 2>/dev/null)
    local mb
    mb=$(echo "scale=2; $FILE_SIZE / 1048576" | bc)
    echo "  + ${mb}MB | $LOCAL_REL.$EXT"
    return 0
  else
    echo "  x FAILED ($HTTP_CODE) | $PID.$EXT"
    rm -f "$LOCAL_PATH"
    return 2  # failed
  fi
}

# ── Fetch inventories ──
echo "--- Images ---"
IMAGES=$(fetch_resources "image")
IMAGE_COUNT=$(echo "$IMAGES" | wc -l | tr -d ' ')
echo "Found $IMAGE_COUNT images."
echo ""

echo "--- Videos ---"
VIDEOS=$(fetch_resources "video")
VIDEO_COUNT=$(echo "$VIDEOS" | wc -l | tr -d ' ')
echo "Found $VIDEO_COUNT videos."
echo ""

echo "--- Raw files (PDFs, SVGs, etc.) ---"
RAW=$(fetch_resources "raw")
RAW_COUNT=$(echo "$RAW" | wc -l | tr -d ' ')
echo "Found $RAW_COUNT raw files."
echo ""

TOTAL=$((IMAGE_COUNT + VIDEO_COUNT + RAW_COUNT))
echo "=========================================="
echo "  Total: $TOTAL assets to download"
echo "=========================================="
echo ""

# ── Download all ──
DOWNLOADED=0
SKIPPED=0
FAILED=0

echo "=== Downloading Images ==="
while IFS='|' read -r pid fmt size w h url; do
  [ -z "$pid" ] && continue
  download_file "$pid" "$fmt" "$size" "$url" "image"
  case $? in
    0) DOWNLOADED=$((DOWNLOADED + 1)) ;;
    1) SKIPPED=$((SKIPPED + 1)) ;;
    2) FAILED=$((FAILED + 1)) ;;
  esac
done <<< "$IMAGES"
echo ""

echo "=== Downloading Videos ==="
while IFS='|' read -r pid fmt size w h url; do
  [ -z "$pid" ] && continue
  download_file "$pid" "$fmt" "$size" "$url" "video"
  case $? in
    0) DOWNLOADED=$((DOWNLOADED + 1)) ;;
    1) SKIPPED=$((SKIPPED + 1)) ;;
    2) FAILED=$((FAILED + 1)) ;;
  esac
done <<< "$VIDEOS"
echo ""

echo "=== Downloading Raw Files ==="
while IFS='|' read -r pid fmt size w h url; do
  [ -z "$pid" ] && continue
  download_file "$pid" "$fmt" "$size" "$url" "raw"
  case $? in
    0) DOWNLOADED=$((DOWNLOADED + 1)) ;;
    1) SKIPPED=$((SKIPPED + 1)) ;;
    2) FAILED=$((FAILED + 1)) ;;
  esac
done <<< "$RAW"
echo ""

echo "=========================================="
echo "  Backup Complete"
echo "  Downloaded: $DOWNLOADED"
echo "  Skipped (already exists): $SKIPPED"
echo "  Failed: $FAILED"
echo "=========================================="
echo ""
echo "Total size:"
du -sh "$OUTPUT_DIR/"
echo ""
echo "Next steps:"
echo "  1. Verify the backup: ls -la $OUTPUT_DIR/"
echo "  2. Set up Cloudflare R2 bucket (see MIGRATION.md)"
echo "  3. Upload: bash scripts/r2-upload.sh"
echo "  4. Update code references (already done if you ran the migration branch)"
