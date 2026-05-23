#!/usr/bin/env bash
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO_ROOT"

mapfile -t files < <(
  git ls-files -- README.md package.json docs src scripts bin \
    | grep -vE '^(docs/plans/|docs/specs/|scripts/audit-generalization\.sh$)'
)

if [ "${#files[@]}" -eq 0 ]; then
  echo "No audit targets found."
  exit 1
fi

readonly DOC_ALLOWLIST=(
  README.md
  docs/providers.md
  docs/task-contracts.md
  docs/migration-from-croprun-scripts.md
)

readonly CROPRUN_ALLOWLIST=(
  "${DOC_ALLOWLIST[@]}"
  scripts/agent-issue-triage/agent.test.ts
  scripts/agent-issue-triage/args.test.ts
  scripts/agent-issue/args.test.ts
  scripts/agent-issue/pipeline.test.ts
  scripts/agent-issue/prompts.test.ts
  scripts/agent-issue/prompts.ts
  scripts/agent-issue/visual-evidence.test.ts
  src/host/forgejo-visual-evidence.test.ts
  src/pi/runner.test.ts
  src/policy/defaults.test.ts
  src/policy/defaults.ts
)

readonly CROPRUN_ENV_ALLOWLIST=(
  docs/migration-from-croprun-scripts.md
  scripts/agent-issue-once.ts
  scripts/agent-issue-triage.ts
  scripts/agent-issue-triage/agent.test.ts
  scripts/agent-issue-triage/args.ts
  scripts/agent-issue-triage/args.test.ts
  scripts/agent-issue-triage/pipeline.ts
  scripts/agent-issue/args.ts
  scripts/agent-issue/args.test.ts
  scripts/agent-issue/pipeline.ts
  scripts/agent-issue/pipeline.test.ts
  scripts/agent-issue/prompts.test.ts
  scripts/agent-issue/visual-evidence.test.ts
  src/cleanup/hooks.ts
  src/host/forgejo-visual-evidence.ts
  src/host/forgejo-visual-evidence.test.ts
  src/policy/defaults.ts
  src/policy/defaults.test.ts
)

readonly TILT_ALLOWLIST=(
  docs/migration-from-croprun-scripts.md
  scripts/agent-issue-triage/agent.test.ts
  scripts/agent-issue/pipeline.test.ts
  scripts/agent-issue/prompts.test.ts
  scripts/agent-issue/tilt-cleanup.ts
  scripts/agent-issue/tilt-cleanup.test.ts
  src/cleanup/hooks.ts
  src/cleanup/hooks.test.ts
  src/policy/defaults.ts
  src/policy/defaults.test.ts
)

readonly DEVENV_ALLOWLIST=(
  docs/migration-from-croprun-scripts.md
  scripts/agent-issue-triage/agent.test.ts
  scripts/agent-issue/prompts.ts
  scripts/agent-issue/prompts.test.ts
  src/pi/runner.test.ts
  src/policy/defaults.ts
  src/policy/defaults.test.ts
)

readonly JUST_TILT_ALLOWLIST=(
  docs/migration-from-croprun-scripts.md
  scripts/agent-issue-triage/agent.test.ts
  scripts/agent-issue/prompts.test.ts
  src/cleanup/hooks.ts
)

readonly LEGACY_PATH_ALLOWLIST=(
  docs/migration-from-croprun-scripts.md
  docs/task-contracts.md
  scripts/agent-issue-triage/args.test.ts
  scripts/agent-issue/args.test.ts
  scripts/agent-issue/git.test.ts
  scripts/agent-issue/pipeline.test.ts
  scripts/agent-issue/progress.test.ts
  src/config/defaults.ts
  src/config/defaults.test.ts
)

readonly REFERENCE_SCREENSHOT_ALLOWLIST=(
  docs/migration-from-croprun-scripts.md
  scripts/agent-issue-triage/agent.test.ts
  scripts/agent-issue/pi.test.ts
  scripts/agent-issue/pipeline.test.ts
  scripts/agent-issue/prompts.test.ts
  scripts/agent-issue/visual-evidence.test.ts
  src/host/forgejo-visual-evidence.test.ts
  src/policy/defaults.ts
  src/policy/defaults.test.ts
)

path_in_allowlist() {
  local path="$1"
  shift

  local allowed
  for allowed in "$@"; do
    if [ "$path" = "$allowed" ]; then
      return 0
    fi
  done

  return 1
}

is_allowed_path() {
  local label="$1"
  local path="$2"

  case "$label" in
    Croprun)
      path_in_allowlist "$path" "${CROPRUN_ALLOWLIST[@]}"
      ;;
    CROPRUN_)
      path_in_allowlist "$path" "${CROPRUN_ENV_ALLOWLIST[@]}"
      ;;
    tilt)
      path_in_allowlist "$path" "${TILT_ALLOWLIST[@]}"
      ;;
    devenv)
      path_in_allowlist "$path" "${DEVENV_ALLOWLIST[@]}"
      ;;
    just\ tilt)
      path_in_allowlist "$path" "${JUST_TILT_ALLOWLIST[@]}"
      ;;
    .pi/agent-issue)
      path_in_allowlist "$path" "${LEGACY_PATH_ALLOWLIST[@]}"
      ;;
    docs/reference-screenshots)
      path_in_allowlist "$path" "${REFERENCE_SCREENSHOT_ALLOWLIST[@]}"
      ;;
    *)
      return 1
      ;;
  esac
}

report_pattern() {
  local label="$1"
  shift
  local found=0
  local unexpected=0

  echo
  echo "## ${label}"
  while IFS=: read -r path line text; do
    [ -n "$path" ] || continue
    found=1
    if is_allowed_path "$label" "$path"; then
      printf 'ALLOWED %s:%s:%s\n' "$path" "$line" "$text"
    else
      unexpected=1
      printf 'UNEXPECTED %s:%s:%s\n' "$path" "$line" "$text"
    fi
  done < <("$@" "${files[@]}" || true)

  if [ "$found" -eq 0 ]; then
    echo "(none)"
  fi

  return "$unexpected"
}

had_unexpected=0
report_pattern "Croprun" grep -EnHi -- 'croprun($|[^_])' || had_unexpected=1
report_pattern "CROPRUN_" grep -FinHi -- 'CROPRUN_' || had_unexpected=1
report_pattern "tilt" grep -FinHi -- 'tilt' || had_unexpected=1
report_pattern "devenv" grep -FinHi -- 'devenv' || had_unexpected=1
report_pattern "just tilt" grep -FinHi -- 'just tilt' || had_unexpected=1
report_pattern ".pi/agent-issue" grep -FinH -- '.pi/agent-issue' || had_unexpected=1
report_pattern "docs/reference-screenshots" grep -FinH -- 'docs/reference-screenshots' || had_unexpected=1

echo
if [ "$had_unexpected" -eq 0 ]; then
  echo "Audit OK: remaining generalization references are limited to documented compatibility docs, tests, and compatibility code paths."
else
  echo "Audit FAILED: unexpected generalization references were found outside documented compatibility locations." >&2
  exit 1
fi
