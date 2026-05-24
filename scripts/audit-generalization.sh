#!/usr/bin/env bash
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO_ROOT"

text() {
  local IFS=""
  printf '%s' "$*"
}

readonly REMOVED_PROJECT_NAME="$(text Crop run)"
readonly REMOVED_ENV_PREFIX="$(text CROP RUN_)"
readonly REMOVED_POLICY_NAME="$(text "$REMOVED_ENV_PREFIX" COMPAT_POLICY)"
readonly REMOVED_CLEANUP_NAME="$(text LEGACY_ CROP RUN_ CLEANUP_HOOKS)"
readonly REMOVED_POLICY_HELPER="$(text is Crop run CompatPolicy)"
readonly REMOVED_STATE_PATH="$(printf '%s/%s' '.pi' 'agent-issue')"
readonly REMOVED_VISUAL_FIXTURE_SEGMENT="$(text reference- screenshots)"
readonly REMOVED_VISUAL_FIXTURE_PATH="$(printf '%s/%s' 'docs' "$REMOVED_VISUAL_FIXTURE_SEGMENT")"
readonly REMOVED_VISUAL_FIXTURE_PATH_ESCAPED="$(printf '%s\\/%s' 'docs' "$REMOVED_VISUAL_FIXTURE_SEGMENT")"

mapfile -t files < <(
  git ls-files -- README.md docs src scripts bin test-support package.json .gitignore \
    | grep -vE '(^|/)(node_modules|dist|coverage)(/|$)|\.lock$' \
    | grep -vE '^(docs/specs/2026-05-24-legacy-seed-removal-design\.md|docs/plans/2026-05-24-legacy-seed-removal\.md)$'
)

if [ "${#files[@]}" -eq 0 ]; then
  echo "No audit targets found." >&2
  exit 1
fi

report_matches() {
  local label="$1"
  shift

  local output
  output=$("$@" 2>/dev/null || true)
  if [ -z "$output" ]; then
    return 1
  fi

  echo
  echo "Forbidden token: $label"
  printf '%s\n' "$output"
  return 0
}

had_failures=0

report_matches "removed project name" grep -nHi --fixed-strings "$REMOVED_PROJECT_NAME" "${files[@]}" && had_failures=1
report_matches "removed env prefix" grep -nH --fixed-strings "$REMOVED_ENV_PREFIX" "${files[@]}" && had_failures=1
report_matches "removed policy constant" grep -nH --fixed-strings "$REMOVED_POLICY_NAME" "${files[@]}" && had_failures=1
report_matches "removed cleanup preset constant" grep -nH --fixed-strings "$REMOVED_CLEANUP_NAME" "${files[@]}" && had_failures=1
report_matches "removed prompt policy helper" grep -nH --fixed-strings "$REMOVED_POLICY_HELPER" "${files[@]}" && had_failures=1
report_matches "removed state path" grep -nH --fixed-strings "$REMOVED_STATE_PATH" "${files[@]}" && had_failures=1
report_matches "removed visual fixture path" grep -nH --fixed-strings "$REMOVED_VISUAL_FIXTURE_PATH" "${files[@]}" && had_failures=1
report_matches "removed escaped visual fixture path" grep -nH --fixed-strings "$REMOVED_VISUAL_FIXTURE_PATH_ESCAPED" "${files[@]}" && had_failures=1

if [ "$had_failures" -ne 0 ]; then
  echo
  echo "Audit FAILED: removed seed-era tokens are still present in tracked product files." >&2
  exit 1
fi

echo "Audit OK: removed seed-era tokens were not found in tracked product files."
