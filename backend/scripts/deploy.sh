#!/usr/bin/env bash
# deploy.sh — controlled, manual deploy of RailBack Lambda code to AWS.
#
# This is the "controlled trigger" (locked 2026-07-09): NOT wired to push.
# You run it when you decide to deploy, using your own AWS CLI credentials.
# It only updates FUNCTION CODE (`aws lambda update-function-code`) — it does
# not create functions, set env vars, wire triggers, or touch IAM. Provision
# those once via console/CLI per PHASE_3C-6_HANDOFF.md; this script ships code
# on top of that.
#
# Safe by default:
#   - Runs typecheck + full test suite first unless --no-check.
#   - Prints the plan and asks for confirmation unless --yes.
#   - Dry-run with --dry-run (build + show what would upload, no AWS calls).
#
# Usage:
#   scripts/deploy.sh                       # check, build, confirm, deploy ALL
#   scripts/deploy.sh user-handler          # just one
#   scripts/deploy.sh --dry-run             # build + plan only, no upload
#   scripts/deploy.sh --no-check --yes user-handler auth-handler
#
# Function-name mapping: logical name -> AWS function name. Override per-lambda
# with env vars like RAILBACK_FN_user_handler=my-user-fn, or set a prefix with
# RAILBACK_FN_PREFIX (default "railback-"), giving e.g. railback-user-handler.
set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BACKEND_ROOT"

OUT="$BACKEND_ROOT/dist-lambdas"
PREFIX="${RAILBACK_FN_PREFIX:-railback-}"
REGION="${RAILBACK_DEPLOY_REGION:-${AWS_REGION:-eu-north-1}}"

RUN_CHECK=1
CONFIRM=1
DRY_RUN=0
TARGETS=()

for arg in "$@"; do
  case "$arg" in
    --no-check) RUN_CHECK=0 ;;
    --yes|-y)   CONFIRM=0 ;;
    --dry-run)  DRY_RUN=1 ;;
    -*)         echo "unknown flag: $arg" >&2; exit 2 ;;
    *)          TARGETS+=("$arg") ;;
  esac
done

# Deployable functions (refund-pdf/pain008-generator are merged into callers).
ALL=(admin-handler anonymisation-sweeper auth-handler email-sweeper \
     email-webhook sepa-reports user-handler ticket-extractor)
[[ ${#TARGETS[@]} -eq 0 ]] && TARGETS=("${ALL[@]}")

# Resolve AWS function name for a logical lambda name.
fn_name() {
  local l="$1"
  local var="RAILBACK_FN_${l//-/_}"   # e.g. RAILBACK_FN_user_handler
  if [[ -n "${!var:-}" ]]; then echo "${!var}"; else echo "${PREFIX}${l}"; fi
}

echo "== RailBack deploy =="
echo "region:  $REGION"
echo "prefix:  $PREFIX"
echo "targets: ${TARGETS[*]}"
echo ""

if [[ $RUN_CHECK -eq 1 ]]; then
  echo ">> running typecheck + tests (skip with --no-check)"
  npm run typecheck
  npm test
  echo "   checks green"
  echo ""
fi

echo ">> building zips"
SKIP_PYTHON="${SKIP_PYTHON:-0}" scripts/build-lambdas.sh "${TARGETS[@]}"
echo ""

echo "== deploy plan =="
for l in "${TARGETS[@]}"; do
  z="$OUT/$l.zip"
  if [[ ! -f "$z" ]]; then echo "  SKIP $l (no zip — merged into caller?)"; continue; fi
  printf "  %-24s -> aws function '%s'  (%s)\n" "$l" "$(fn_name "$l")" "$z"
done
echo ""

if [[ $DRY_RUN -eq 1 ]]; then echo "dry-run: no AWS calls made."; exit 0; fi

if [[ $CONFIRM -eq 1 ]]; then
  read -r -p "Upload the above to AWS in $REGION? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "aborted."; exit 1; }
fi

for l in "${TARGETS[@]}"; do
  z="$OUT/$l.zip"
  [[ -f "$z" ]] || continue
  fn="$(fn_name "$l")"
  echo ">> uploading $l -> $fn"
  aws lambda update-function-code \
    --region "$REGION" \
    --function-name "$fn" \
    --zip-file "fileb://$z" \
    --publish \
    --output json --query '{Fn:FunctionName,Ver:Version,Size:CodeSize,State:LastUpdateStatus}' \
    || { echo "   !! upload failed for $fn (does the function exist? check name/region/creds)" >&2; exit 1; }
done

echo ""
echo "done. Note: if you changed handler signatures or env needs, update config"
echo "separately — this script ships code only."
