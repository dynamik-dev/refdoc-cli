#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SUITE="${ROOT_DIR}/docs/eval-suite.example.json"
OUT_DIR="${ROOT_DIR}/eval-reports"
RESULTS=""
SKIP_INDEX=0

usage() {
  cat <<'EOF'
Usage:
  scripts/run-eval.sh [options]

Options:
  --suite <path>      Eval suite JSON path (default: docs/eval-suite.example.json)
  --results <count>   Results per query override passed to `refdocs eval -n`
  --out-dir <dir>     Output directory for timestamped reports (default: eval-reports)
  --skip-index        Skip `refdocs index` and run eval only
  -h, --help          Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --suite)
      [[ $# -lt 2 ]] && { echo "Missing value for --suite" >&2; exit 1; }
      SUITE="$2"
      shift 2
      ;;
    --results)
      [[ $# -lt 2 ]] && { echo "Missing value for --results" >&2; exit 1; }
      RESULTS="$2"
      shift 2
      ;;
    --out-dir)
      [[ $# -lt 2 ]] && { echo "Missing value for --out-dir" >&2; exit 1; }
      OUT_DIR="$2"
      shift 2
      ;;
    --skip-index)
      SKIP_INDEX=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$SUITE" ]]; then
  echo "Suite file not found: $SUITE" >&2
  exit 1
fi

TSX_LOADER="${ROOT_DIR}/node_modules/tsx/dist/loader.mjs"
if [[ ! -f "$TSX_LOADER" ]]; then
  echo "Missing tsx loader at ${TSX_LOADER}. Run npm install first." >&2
  exit 1
fi

run_refdocs() {
  node --import "$TSX_LOADER" "${ROOT_DIR}/src/index.ts" "$@"
}

mkdir -p "$OUT_DIR"

SUITE_BASE="$(basename "$SUITE")"
SUITE_STEM="${SUITE_BASE%.*}"
SUITE_SLUG="$(printf '%s' "$SUITE_STEM" | tr -cs 'A-Za-z0-9._-' '-')"
TIMESTAMP="$(date -u +"%Y%m%d-%H%M%SZ")"
REPORT_PATH="${OUT_DIR}/${SUITE_SLUG}-${TIMESTAMP}.json"
LATEST_PATH="${OUT_DIR}/${SUITE_SLUG}-latest.json"

cd "$ROOT_DIR"

if [[ "$SKIP_INDEX" -eq 0 ]]; then
  echo "Running index..."
  run_refdocs index
fi

echo "Running eval..."
if [[ -n "$RESULTS" ]]; then
  run_refdocs eval "$SUITE" -n "$RESULTS" --json > "$REPORT_PATH"
else
  run_refdocs eval "$SUITE" --json > "$REPORT_PATH"
fi

ln -sf "$(basename "$REPORT_PATH")" "$LATEST_PATH"

echo "Saved report: $REPORT_PATH"
echo "Latest link:  $LATEST_PATH"
