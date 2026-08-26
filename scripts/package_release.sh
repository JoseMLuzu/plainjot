#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
app_path="$project_dir/dist/PlainJot.app"
version=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$project_dir/macos/Info.plist")
archive_path="$project_dir/dist/PlainJot-$version-macOS.zip"

"$script_dir/build_macos_app.sh"
rm -f "$archive_path"
ditto -c -k --keepParent --norsrc "$app_path" "$archive_path"
unzip -tq "$archive_path"
echo "$archive_path"
