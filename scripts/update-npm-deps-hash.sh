#!/usr/bin/env bash
set -euo pipefail

build_target="${1:-.#patchmill}"
log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

if nix build --print-build-logs "$build_target" >"$log_file" 2>&1; then
  echo "npmDepsHash already matches the build output."
  exit 0
fi

got_hash="$(awk '/got:[[:space:]]+sha256-/ { print $2 }' "$log_file" | tail -n 1)"
if [[ -z "$got_hash" ]]; then
  cat "$log_file"
  echo "Nix build failed, but no fixed-output hash mismatch was found." >&2
  exit 1
fi

python - "$got_hash" <<'PY'
import pathlib
import re
import sys

got_hash = sys.argv[1]
package_file = pathlib.Path("nix/package.nix")
text = package_file.read_text()
updated = re.sub(
    r'npmDepsHash = "sha256-[^"]+";',
    f'npmDepsHash = "{got_hash}";',
    text,
    count=1,
)
if updated == text:
    raise SystemExit("npmDepsHash assignment not found in nix/package.nix")
package_file.write_text(updated)
PY

nix build --print-build-logs "$build_target"
echo "Updated npmDepsHash to $got_hash."
