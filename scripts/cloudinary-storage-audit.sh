#!/bin/bash
# ============================================================
# Cloudinary Storage Audit — Find oversized assets
# Run this locally where api.cloudinary.com is accessible
# ============================================================

CLOUD="ddcynsa30"
API="https://api.cloudinary.com/v1_1/$CLOUD"
AUTH="617726211878669:n90Ts-IUyUnxwNdtQd9i64d6Gtw"

echo "=========================================="
echo "  Cloudinary Storage Audit"
echo "=========================================="
echo ""

# ── 1. Account usage overview ──
echo "── 1. Account Usage ──"
curl -s "$API/usage" -u "$AUTH" | python3 -m json.tool
echo ""

# ── 2. Find the largest image assets (>2MB) ──
echo "── 2. Largest Images (sorted by size, >2MB) ──"
echo "Fetching images over 2MB..."
# Search API: find images larger than 2MB
curl -s -X POST "$API/resources/search" \
  -u "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "expression": "folder:yoga-bible-DK/* AND bytes > 2000000 AND resource_type:image",
    "sort_by": [{"bytes": "desc"}],
    "max_results": 50,
    "fields": ["public_id", "bytes", "width", "height", "format", "created_at"]
  }' | python3 -c "
import sys, json
data = json.load(sys.stdin)
resources = data.get('resources', [])
total = 0
print(f'Found {len(resources)} images over 2MB:')
print(f'{\"Public ID\":<70} {\"Size\":>8} {\"Dims\":>12} {\"Format\":>6}')
print('-' * 100)
for r in resources:
    mb = r['bytes'] / 1024 / 1024
    total += r['bytes']
    dims = f\"{r.get('width','?')}x{r.get('height','?')}\"
    print(f\"{r['public_id']:<70} {mb:>6.1f}MB {dims:>12} {r.get('format','?'):>6}\")
print(f'\nTotal from large images: {total/1024/1024:.1f}MB')
"
echo ""

# ── 3. Find the largest video assets (>10MB) ──
echo "── 3. Largest Videos (sorted by size, >10MB) ──"
curl -s -X POST "$API/resources/search" \
  -u "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "expression": "folder:yoga-bible-DK/* AND bytes > 10000000 AND resource_type:video",
    "sort_by": [{"bytes": "desc"}],
    "max_results": 50,
    "fields": ["public_id", "bytes", "width", "height", "format", "duration", "created_at"]
  }' | python3 -c "
import sys, json
data = json.load(sys.stdin)
resources = data.get('resources', [])
total = 0
print(f'Found {len(resources)} videos over 10MB:')
print(f'{\"Public ID\":<70} {\"Size\":>8} {\"Duration\":>8} {\"Format\":>6}')
print('-' * 100)
for r in resources:
    mb = r['bytes'] / 1024 / 1024
    total += r['bytes']
    dur = f\"{r.get('duration', 0):.0f}s\" if r.get('duration') else '?'
    print(f\"{r['public_id']:<70} {mb:>6.1f}MB {dur:>8} {r.get('format','?'):>6}\")
print(f'\nTotal from large videos: {total/1024/1024:.1f}MB')
"
echo ""

# ── 4. Find duplicate/similar images ──
echo "── 4. Raw files (unoptimized originals that could be replaced with f_auto) ──"
curl -s -X POST "$API/resources/search" \
  -u "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "expression": "folder:yoga-bible-DK/* AND (format:png OR format:tiff OR format:bmp) AND bytes > 500000",
    "sort_by": [{"bytes": "desc"}],
    "max_results": 30,
    "fields": ["public_id", "bytes", "width", "height", "format"]
  }' | python3 -c "
import sys, json
data = json.load(sys.stdin)
resources = data.get('resources', [])
total = 0
print(f'Found {len(resources)} unoptimized images (PNG/TIFF/BMP over 500KB):')
print(f'{\"Public ID\":<70} {\"Size\":>8} {\"Format\":>6}')
print('-' * 96)
for r in resources:
    mb = r['bytes'] / 1024 / 1024
    total += r['bytes']
    print(f\"{r['public_id']:<70} {mb:>6.1f}MB {r.get('format','?'):>6}\")
print(f'\nTotal wasted by unoptimized formats: {total/1024/1024:.1f}MB')
print('TIP: These can be re-uploaded as WebP/AVIF or served with f_auto transform.')
"
echo ""

# ── 5. Summary of storage per folder ──
echo "── 5. Storage per top-level folder ──"
for folder in brand homepage studio location courses programs accommodation concepts copenhagen careers apply compare mentorship link schedule member journal materials tutorials yogamusic yogaphotography "schedule-pages" "YTT Programs"; do
  size=$(curl -s -X POST "$API/resources/search" \
    -u "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"expression\": \"folder:yoga-bible-DK/$folder/*\", \"aggregate\": [\"bytes\"], \"max_results\": 0}" \
    2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
agg = data.get('aggregations', {})
# fallback: sum from resources
print(data.get('total_count', 0))
" 2>/dev/null)
  echo "  yoga-bible-DK/$folder/  →  $size assets"
done

echo ""
echo "=========================================="
echo "  Audit complete!"
echo "  Run the suggested optimizations above."
echo "=========================================="
