#!/usr/bin/env bash
set -euo pipefail

build_target="${1:-.#patchmill}"
log_file="$(mktemp)"
original_package_file="$(mktemp)"
trap 'rm -f "$log_file" "$original_package_file"' EXIT

cp nix/package.nix "$original_package_file"

extract_got_hash() {
  awk '
    $1 == "got:" && $2 ~ /^sha256-/ { print $2 }
    $1 == ">" && $2 == "got:" && $3 ~ /^sha256-/ { print $3 }
  ' "$1" | tail -n 1
}

set_npm_deps_hash() {
  local hash_value="$1"
  python - "$hash_value" <<'PY'
import pathlib
import re
import sys

hash_value = sys.argv[1]
package_file = pathlib.Path("nix/package.nix")
text = package_file.read_text()
updated = re.sub(
    r'npmDepsHash = (?:lib\.fakeHash|"sha256-[^"]+");',
    f'npmDepsHash = {hash_value};' if hash_value == "lib.fakeHash" else f'npmDepsHash = "{hash_value}";',
    text,
    count=1,
)
if updated == text:
    raise SystemExit("npmDepsHash assignment not found in nix/package.nix")
package_file.write_text(updated)
PY
}

if nix build --print-build-logs "$build_target" >"$log_file" 2>&1; then
  echo "npmDepsHash already matches the build output."
  exit 0
fi

got_hash="$(extract_got_hash "$log_file")"

if [[ -z "$got_hash" ]] && grep -q "npmDepsHash is out of date" "$log_file"; then
  set_npm_deps_hash lib.fakeHash
  if nix build --print-build-logs "$build_target" >"$log_file" 2>&1; then
    echo "Unexpected success with lib.fakeHash." >&2
    exit 1
  fi
  got_hash="$(extract_got_hash "$log_file")"
fi

if [[ -z "$got_hash" ]]; then
  cp "$original_package_file" nix/package.nix
  cat "$log_file"
  echo "Nix build failed, but no fixed-output hash mismatch was found." >&2
  exit 1
fi

set_npm_deps_hash "$got_hash"

nix build --print-build-logs "$build_target"
echo "Updated npmDepsHash to $got_hash."
