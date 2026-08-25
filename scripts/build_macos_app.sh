#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
app_dir="$project_dir/dist/PlainJot.app"
contents_dir="$app_dir/Contents"
resources_dir="$contents_dir/Resources"
web_dir="$resources_dir/Web"
build_dir="$project_dir/build/macos"

rm -rf "$app_dir" "$build_dir"
mkdir -p "$contents_dir/MacOS" "$web_dir" "$build_dir/icons"

xcrun swiftc \
  "$project_dir/macos/main.swift" \
  -framework AppKit \
  -framework WebKit \
  -o "$contents_dir/MacOS/PlainJot"

cp "$project_dir/macos/Info.plist" "$contents_dir/Info.plist"
cp "$project_dir/static/index.html" "$web_dir/index.html"
cp "$project_dir/static/style.css" "$web_dir/style.css"
cp "$project_dir/static/app.js" "$web_dir/app.js"
cp "$project_dir/macos/native-bridge.js" "$resources_dir/native-bridge.js"

xcrun swift "$project_dir/macos/generate_icon.swift" "$build_dir/icon-1024.png"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$build_dir/icon-1024.png" --out "$build_dir/icons/icon-${size}.png" >/dev/null
done
xcrun swift "$project_dir/macos/make_icns.swift" \
  "$resources_dir/PlainJot.icns" \
  icp4 "$build_dir/icons/icon-16.png" \
  icp5 "$build_dir/icons/icon-32.png" \
  ic07 "$build_dir/icons/icon-128.png" \
  ic08 "$build_dir/icons/icon-256.png" \
  ic09 "$build_dir/icons/icon-512.png" \
  ic10 "$build_dir/icon-1024.png"

codesign --force --deep --sign - "$app_dir"
echo "$app_dir"
