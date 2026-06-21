#!/bin/bash
set -e

VERSION="3.0.5"

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    DMG="SJTU.Canvas.Helper_${VERSION}_aarch64.dmg"
elif [ "$ARCH" = "x86_64" ]; then
    DMG="SJTU.Canvas.Helper_x64.app.tar.gz"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

URL="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/releases/download/app-v${VERSION}/${DMG}"

echo "============================================"
echo "   SJTU Canvas Helper v${VERSION} Installer"
echo "============================================"
echo ""

echo "Detected architecture: $ARCH"
echo "Downloading ${DMG} ..."
echo ""

curl -L -o "$DMG" "$URL"

echo ""
echo "Download complete. Installing..."
echo ""

if [ "$ARCH" = "arm64" ]; then
    # Dynamically fetch the mount point to prevent hardcoded path failures
    MOUNT_DIR=$(hdiutil attach "$DMG" -nobrowse -plist | grep -A 1 '<key>mount-point</key>' | grep '<string>' | sed -E 's/.*<string>(.*)<\/string>.*/\1/')
    
    if [ -d "$MOUNT_DIR/SJTU Canvas Helper.app" ]; then
        cp -R "$MOUNT_DIR/SJTU Canvas Helper.app" /Applications/
    else
        # Fallback in case there is no space in the app name
        cp -R "$MOUNT_DIR"/SJTU*.app /Applications/
    fi
    
    hdiutil detach "$MOUNT_DIR" -quiet
    rm "$DMG"
else
    tar -xzf "$DMG"
    
    if [ -d "SJTU Canvas Helper.app" ]; then
        mv "SJTU Canvas Helper.app" /Applications/
    elif [ -d "SJTU_Canvas_Helper.app" ]; then
        mv "SJTU_Canvas_Helper.app" /Applications/
    fi
    
    rm "$DMG"
fi

echo ""
echo "Installation completed successfully!"