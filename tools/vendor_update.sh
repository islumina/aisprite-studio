#!/bin/bash
set -e

VENDOR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../webeditor/vendor" && pwd)"
cd "$VENDOR_DIR"

echo "Updating vendored packages in $VENDOR_DIR to latest..."

for pkg in aieventjs aipooljs aifsmjs; do
    echo "Updating $pkg..."
    rm -rf "$pkg"
    mkdir "$pkg"
    
    # Download tarball and extract to temp
    TMP_DIR=$(mktemp -d)
    (
        cd "$TMP_DIR"
        npm pack "$pkg@latest"
        tar -xzf "$pkg"*.tgz
    )
    
    # We only want the ESM and package.json to track version
    mv "$TMP_DIR/package/dist/index.js" "$pkg/"
    mv "$TMP_DIR/package/dist/index.d.ts" "$pkg/" 2>/dev/null || true
    mv "$TMP_DIR/package/package.json" "$pkg/"
    
    # Also grab the types file if it exists (for aifsmjs)
    mv "$TMP_DIR/package/dist/types-"*.d.ts "$pkg/" 2>/dev/null || true
    
    # Clean up temp
    rm -rf "$TMP_DIR"
done

echo "Vendor update complete."
