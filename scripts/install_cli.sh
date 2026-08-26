#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
project_dir=${script_dir:h}
local_root=${PLAINJOT_LOCAL_ROOT:-$HOME/.local}
share_dir="$local_root/share/plainjot"
bin_dir="$local_root/bin"

mkdir -p "$share_dir" "$bin_dir"
mkdir -p "$share_dir/plainjot_core"
cp "$project_dir/plainjot_core/"*.py "$share_dir/plainjot_core/"
install -m 755 "$project_dir/plainjot" "$bin_dir/plainjot"

echo "Installed plainjot at $bin_dir/plainjot"
if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
  echo "Add $bin_dir to PATH to run plainjot from any directory."
fi
