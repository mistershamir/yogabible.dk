#!/bin/bash
# ============================================================
# Upload backed-up Cloudinary assets to Cloudflare R2
#
# Prerequisites:
#   1. Create Cloudflare account (free) at https://dash.cloudflare.com
#   2. Go to R2 → Create bucket → name it "yogabible-media"
#   3. Enable public access: R2 → yogabible-media → Settings →
#      Public access → Custom domain → add "media.yogabible.dk"
#      (or use the free r2.dev subdomain for testing)
#   4. Create R2 API token: R2 → Manage R2 API Tokens →
#      Create API token → Admin Read & Write → Create
#   5. Install rclone: brew install rclone
#   6. Configure rclone:
#      rclone config
#        → n (new remote)
#        → name: r2
#        → type: s3
#        → provider: Cloudflare
#        → access_key_id: <your R2 access key>
#        → secret_access_key: <your R2 secret key>
#        → endpoint: https://<account-id>.r2.cloudflarestorage.com
#        → Leave rest blank/default
#
# Usage:
#   bash scripts/r2-upload.sh
#   bash scripts/r2-upload.sh --dry-run
# ============================================================

set -euo pipefail

BACKUP_DIR="cloudinary-backup"
R2_REMOTE="r2"
R2_BUCKET="yogabible-media"
R2_PATH="yoga-bible-DK"

DRY_RUN=""
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN="--dry-run" ;;
  esac
done

# Check prerequisites
if ! command -v rclone &> /dev/null; then
  echo "Error: rclone is not installed."
  echo "Install it: brew install rclone"
  echo "Then configure: rclone config (see script header for steps)"
  exit 1
fi

if [ ! -d "$BACKUP_DIR" ]; then
  echo "Error: $BACKUP_DIR/ not found."
  echo "Run the download script first: bash scripts/cloudinary-download-all.sh"
  exit 1
fi

echo "=========================================="
echo "  Upload to Cloudflare R2"
echo "  Source: ./$BACKUP_DIR/"
echo "  Dest:   $R2_REMOTE:$R2_BUCKET/$R2_PATH/"
echo "=========================================="
echo ""

# Show what we're uploading
echo "Local backup contents:"
du -sh "$BACKUP_DIR/"
echo "Files: $(find "$BACKUP_DIR" -type f | wc -l | tr -d ' ')"
echo ""

# Upload with rclone
# --transfers=10: parallel uploads
# --checkers=20: parallel hash checks
# --fast-list: use fewer API calls
# --progress: show progress
# --no-update-modtime: R2 doesn't support modtime well
rclone sync "$BACKUP_DIR/" "$R2_REMOTE:$R2_BUCKET/$R2_PATH/" \
  --transfers=10 \
  --checkers=20 \
  --fast-list \
  --progress \
  --no-update-modtime \
  $DRY_RUN

echo ""
echo "=========================================="
echo "  Upload Complete!"
echo "=========================================="
echo ""
echo "Your assets are now at:"
echo "  R2 bucket: $R2_BUCKET/$R2_PATH/"
echo ""
echo "If you set up a custom domain (media.yogabible.dk):"
echo "  https://media.yogabible.dk/yoga-bible-DK/brand/logo.png"
echo ""
echo "Or using r2.dev subdomain:"
echo "  https://pub-<hash>.r2.dev/yoga-bible-DK/brand/logo.png"
echo ""
echo "Next: update your .env or Netlify env vars:"
echo "  MEDIA_BASE_URL=https://media.yogabible.dk"
