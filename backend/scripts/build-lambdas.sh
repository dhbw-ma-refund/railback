#!/usr/bin/env bash
# build-lambdas.sh — produce deployable Lambda zips for every RailBack function.
#
# Reproducible, offline, no AWS calls. Output: backend/dist-lambdas/<name>.zip.
# Run from anywhere; paths are anchored to the backend root.
#
# What it builds:
#   - 7 Node "handler" Lambdas: each esbuild-bundled to a single CJS index.js
#     (@railback/lib inlined; the AWS SDK v3 clients the Node 20 runtime ships
#     are marked external). refund-pdf + pain008-generator are NOT standalone
#     functions — they are library modules bundled INTO their callers
#     (user-handler / admin-handler) via the in-process dynamic-import shim, so
#     they get no zip of their own (locked 2026-07-09, "merge into caller").
#   - refund-pdf's PDF template ships inside the user-handler zip under assets/.
#   - 1 Python Lambda: ticket-extractor (delegates to its own BUILD.md recipe
#     via uv; requires `uv` on PATH).
#
# Usage:
#   scripts/build-lambdas.sh            # build everything
#   scripts/build-lambdas.sh user-handler auth-handler   # build a subset
#   SKIP_PYTHON=1 scripts/build-lambdas.sh   # node only (no uv needed)
set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BACKEND_ROOT"

OUT="$BACKEND_ROOT/dist-lambdas"
mkdir -p "$OUT"

# AWS SDK v3 clients bundled into the Node 20.x managed runtime — mark external
# so we don't bloat every zip with a copy. Anything NOT here (e.g.
# s3-presigned-post, s3-request-presigner) is pure-JS and gets inlined.
SDK_EXTERNAL=(
  --external:@aws-sdk/client-dynamodb
  --external:@aws-sdk/lib-dynamodb
  --external:@aws-sdk/client-s3
  --external:@aws-sdk/client-sesv2
)

# Deployable Node handler Lambdas. refund-pdf + pain008-generator intentionally
# absent — merged into user-handler / admin-handler.
NODE_LAMBDAS=(
  admin-handler
  anonymisation-sweeper
  auth-handler
  email-sweeper
  email-webhook
  sepa-reports
  user-handler
)

# Pick src/index.ts if present (re-exports handler), else src/handler.ts.
entry_for() {
  local l="$1"
  if [[ -f "lambdas/$l/src/index.ts" ]]; then
    echo "lambdas/$l/src/index.ts"
  else
    echo "lambdas/$l/src/handler.ts"
  fi
}

build_node() {
  local l="$1"
  local entry stage
  entry="$(entry_for "$l")"
  stage="$(mktemp -d)"
  echo ">> building node lambda: $l  (entry: $entry)"

  npx esbuild "$entry" \
    --bundle --platform=node --target=node20 --format=cjs \
    "${SDK_EXTERNAL[@]}" \
    --outfile="$stage/index.js"

  # user-handler bundles refund-pdf (dynamic import); refund-pdf reads its PDF
  # template from ./assets next to the bundle. Ship it.
  if [[ "$l" == "user-handler" ]]; then
    mkdir -p "$stage/assets"
    cp lambdas/refund-pdf/assets/reimbursement-form_de.pdf "$stage/assets/"
  fi

  ( cd "$stage" && zip -q -r -X "$OUT/$l.zip" . )
  rm -rf "$stage"
  echo "   -> $OUT/$l.zip"
}

build_python_extractor() {
  local l="ticket-extractor"
  echo ">> building python lambda: $l (via uv, per its BUILD.md)"
  if ! command -v uv >/dev/null 2>&1; then
    echo "   !! uv not on PATH — skipping $l. Install uv or set SKIP_PYTHON=1." >&2
    return 1
  fi
  ( cd "lambdas/$l"
    rm -rf .build .venv-build
    UV_PROJECT_ENVIRONMENT=.venv-build uv sync \
      --no-dev --frozen --no-install-project \
      --python 3.12 --python-preference managed
    mkdir -p .build
    cp -r src vendor .build/
    cp -r .venv-build/lib/python3.12/site-packages/* .build/
    ( cd .build && zip -q -r -X "$OUT/ticket-extractor.zip" . )
    rm -rf .build .venv-build
  )
  echo "   -> $OUT/ticket-extractor.zip  (handler: src.handler.lambda_handler)"
}

TARGETS=("$@")
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("${NODE_LAMBDAS[@]}")
  [[ "${SKIP_PYTHON:-0}" == "1" ]] || TARGETS+=("ticket-extractor")
fi

for t in "${TARGETS[@]}"; do
  if [[ "$t" == "ticket-extractor" ]]; then
    build_python_extractor
  elif printf '%s\n' "${NODE_LAMBDAS[@]}" | grep -qx "$t"; then
    build_node "$t"
  elif [[ "$t" == "refund-pdf" || "$t" == "pain008-generator" ]]; then
    echo ">> skip $t — merged into its caller (user-handler / admin-handler). No standalone zip."
  else
    echo "!! unknown lambda: $t" >&2; exit 2
  fi
done

echo ""
echo "built zips in $OUT:"
ls -lh "$OUT"/*.zip 2>/dev/null | awk '{print "  " $9 "  " $5}'
