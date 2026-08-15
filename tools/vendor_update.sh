#!/bin/bash
set -e

VENDOR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../webeditor/vendor" && pwd)"
SOURCE_ROOT="$(cd "$VENDOR_DIR/../../.." && pwd)"
cd "$VENDOR_DIR"

echo "Updating vendored packages in $VENDOR_DIR..."

STAGE_DIR=$(mktemp -d "$VENDOR_DIR/.vendor-stage.XXXXXX")
trap 'rm -rf "$STAGE_DIR"' EXIT

for pkg in aieventjs aipooljs aifsmjs aispritejs; do
    echo "Updating $pkg..."
    OUTPUT_DIR="$STAGE_DIR/output-$pkg"
    LOCAL_PACKAGE_DIR="$SOURCE_ROOT/$pkg"
    mkdir "$OUTPUT_DIR"

    if [ -f "$LOCAL_PACKAGE_DIR/package.json" ] && [ -f "$LOCAL_PACKAGE_DIR/dist/index.js" ]; then
        PACKAGE_ROOT="$LOCAL_PACKAGE_DIR"
        echo "  source: $LOCAL_PACKAGE_DIR"
    else
        PACKAGE_DIR="$STAGE_DIR/package-$pkg"
        mkdir "$PACKAGE_DIR"
        (
            cd "$PACKAGE_DIR"
            npm pack "$pkg@latest"
            tar -xzf "$pkg"*.tgz
        )
        PACKAGE_ROOT="$PACKAGE_DIR/package"
        echo "  source: npm latest"
    fi

    # Keep every published ESM subpath. aispritejs exposes /atlas and /pixi.
    find "$PACKAGE_ROOT/dist" -type f \( -name '*.js' -o -name '*.d.ts' \) -exec sh -c '
        src="$1"
        root="$2"
        output="$3"
        dest="$output/${src#"$root"/}"
        mkdir -p "$(dirname "$dest")"
        cp "$src" "$dest"
    ' sh {} "$PACKAGE_ROOT/dist" "$OUTPUT_DIR" \;
    cp "$PACKAGE_ROOT/package.json" "$OUTPUT_DIR/"
done

for pkg in aieventjs aipooljs aifsmjs aispritejs; do
    mkdir -p "$pkg"
    cp -R "$STAGE_DIR/output-$pkg/." "$pkg/"
done

test -f "$VENDOR_DIR/aispritejs/index.js"
test -f "$VENDOR_DIR/aispritejs/atlas/index.js"
test -f "$VENDOR_DIR/aispritejs/pixi/index.js"

echo "Vendor update complete."
