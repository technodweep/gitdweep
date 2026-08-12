#!/usr/bin/env bash
# Run project diagnostics; write capture logs + run-summary.txt
set -u
cd "$(dirname "$0")"

export PATH="${HOME}/.local/share/fnm/node-versions/v22.23.2/installation/bin:${HOME}/.cargo/bin:/usr/bin:/bin:${PATH}"
export PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig:${PKG_CONFIG_PATH:-}"

SUMMARY="run-summary.txt"
{
  echo "# Diagnostic run summary"
  echo "Date: $(date -Iseconds 2>/dev/null || date)"
  echo "Workspace: $(pwd)"
  echo "PATH node: $(command -v node 2>/dev/null || echo MISSING)"
  echo "node -v: $(node -v 2>/dev/null || echo n/a)"
  echo "PATH cargo: $(command -v cargo 2>/dev/null || echo MISSING)"
  echo "cargo -V: $(cargo -V 2>/dev/null || echo n/a)"
  echo ""
} > "$SUMMARY"

echo "=== 1/3 cargo check ==="
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tee cargo-check-capture.log
CARGO_EXIT=${PIPESTATUS[0]}
{
  echo "## 1. cargo check --manifest-path src-tauri/Cargo.toml"
  echo "- **Status:** $([[ $CARGO_EXIT -eq 0 ]] && echo PASS || echo FAIL)"
  echo "- **Exit code:** $CARGO_EXIT"
  echo "- **Log file:** cargo-check-capture.log"
  echo "- **Error lines:**"
  if grep -E 'error(\[E[0-9]+\])?:' cargo-check-capture.log >/tmp/cargo-errs.txt 2>/dev/null && [[ -s /tmp/cargo-errs.txt ]]; then
    sed 's/^/  /' /tmp/cargo-errs.txt
  else
    echo "  (none matched, or clean build)"
  fi
  echo ""
} >> "$SUMMARY"

echo "=== 2/3 tsc --noEmit ==="
npx tsc --noEmit 2>&1 | tee tsc-capture.log
TSC_EXIT=${PIPESTATUS[0]}
{
  echo "## 2. npx tsc --noEmit"
  echo "- **Status:** $([[ $TSC_EXIT -eq 0 ]] && echo PASS || echo FAIL)"
  echo "- **Exit code:** $TSC_EXIT"
  echo "- **Log file:** tsc-capture.log"
  echo "- **Error lines:**"
  if grep -E 'error TS[0-9]+' tsc-capture.log >/tmp/tsc-errs.txt 2>/dev/null && [[ -s /tmp/tsc-errs.txt ]]; then
    sed 's/^/  /' /tmp/tsc-errs.txt
  else
    echo "  (none matched, or clean typecheck)"
  fi
  echo ""
} >> "$SUMMARY"

echo "=== 3/3 tauri:dev (timeout 120s) ==="
(timeout 120 npm run tauri:dev || true) 2>&1 | tee tauri-dev-capture.log
TAURI_EXIT=${PIPESTATUS[0]}
{
  echo "## 3. (timeout 120 npm run tauri:dev || true)"
  echo "- **Status:** RAN (timeout/||true always soft-exit)"
  echo "- **Pipeline exit code:** $TAURI_EXIT"
  echo "- **Log file:** tauri-dev-capture.log"
  echo "- **Notable lines (error/fail/panic):**"
  if grep -iE 'error|panic|failed|FAIL' tauri-dev-capture.log >/tmp/tauri-errs.txt 2>/dev/null && [[ -s /tmp/tauri-errs.txt ]]; then
    head -n 80 /tmp/tauri-errs.txt | sed 's/^/  /'
  else
    echo "  (none matched)"
  fi
  echo ""
  echo "## Overall"
  echo "- cargo: $CARGO_EXIT"
  echo "- tsc: $TSC_EXIT"
  echo "- tauri pipeline: $TAURI_EXIT"
} >> "$SUMMARY"

echo "Done. Summary written to $SUMMARY"
cat "$SUMMARY"
