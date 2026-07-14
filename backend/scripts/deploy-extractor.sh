#!/usr/bin/env bash
# deploy-extractor.sh — deploy the Python ticket-extractor to a DEDICATED
# function, separate from the Node dispatcher (deploy-single.sh).
#
# In the single-function environment there is no S3 trigger, so the dispatcher
# invokes this function synchronously from POST /users/me/tickets/{id}/upload-
# confirm (see lambdas/user-handler/src/routes/invoke-extractor.ts). For that to
# work you must:
#   1. deploy this extractor to some function slot (this script), AND
#   2. set RAILBACK_EXTRACTOR_FUNCTION=<that function name> in the dispatcher's
#      environment.json, AND
#   3. ensure the dispatcher has lambda:InvokeFunction on the extractor (the
#      shared student role already allows Invoke in this sandbox).
#
# The extractor also needs to read S3 + read/write the DDB table, which the
# shared execution role provides.
#
# Prereqs: export AWS_PROFILE=railback ; `uv` on PATH (for the Python build).
#
# Usage:
#   RAILBACK_EXTRACTOR_FN=s212485 scripts/deploy-extractor.sh
#   RAILBACK_EXTRACTOR_FN=s212485 scripts/deploy-extractor.sh --code-only
#   RAILBACK_EXTRACTOR_FN=s212485 scripts/deploy-extractor.sh --yes
set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BACKEND_ROOT"

FN="${RAILBACK_EXTRACTOR_FN:-}"
REGION="${RAILBACK_DEPLOY_REGION:-${AWS_REGION:-eu-north-1}}"
ZIP="$BACKEND_ROOT/dist-lambdas/ticket-extractor.zip"

[[ -n "$FN" ]] || { echo "!! set RAILBACK_EXTRACTOR_FN=<function-name> (a Python slot to host the extractor)" >&2; exit 2; }

DO_CONFIG=1; DO_CODE=1; CONFIRM=1
for arg in "$@"; do
  case "$arg" in
    --code-only) DO_CONFIG=0 ;;
    --yes|-y)    CONFIRM=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

aws sts get-caller-identity >/dev/null 2>&1 || { echo "!! no AWS creds. export AWS_PROFILE=railback" >&2; exit 1; }

echo "== RailBack ticket-extractor deploy =="
echo "function: $FN   region: $REGION"
echo "NOTE: this OVERWRITES the code on '$FN'. Only use a slot you're allowed to."
[[ $CONFIRM -eq 1 ]] && { read -r -p "Proceed? [y/N] " a; [[ "$a" == y || "$a" == Y ]] || { echo aborted; exit 1; }; }

wait_settle() { aws lambda wait function-updated --region "$REGION" --function-name "$FN"; }

if [[ $DO_CONFIG -eq 1 ]]; then
  echo ">> runtime python3.12 / handler src.handler.lambda_handler / mem 512 / timeout 30"
  aws lambda update-function-configuration --region "$REGION" --function-name "$FN" \
    --runtime python3.12 --handler src.handler.lambda_handler --memory-size 512 --timeout 30 \
    --query '{Runtime:Runtime,Handler:Handler,Mem:MemorySize,Timeout:Timeout}' --output json
  wait_settle
  echo ">> env (DDB table + demo public-read fetch flag; bucket+key come from the invoke event; region is Lambda-native)"
  aws lambda update-function-configuration --region "$REGION" --function-name "$FN" \
    --environment "Variables={RAILBACK_DDB_TABLE=${RAILBACK_DDB_TABLE:-RailBack},RAILBACK_S3_PUBLIC_READ=${RAILBACK_S3_PUBLIC_READ:-1}}" \
    --query 'Environment.Variables | keys(@)' --output json
  wait_settle
fi

if [[ $DO_CODE -eq 1 ]]; then
  echo ">> build python zip (uv)"
  scripts/build-lambdas.sh ticket-extractor
  echo ">> upload code ($(du -h "$ZIP" | cut -f1))"
  aws lambda update-function-code --region "$REGION" --function-name "$FN" \
    --zip-file "fileb://$ZIP" --publish \
    --query '{Fn:FunctionName,Size:CodeSize,State:LastUpdateStatus}' --output json
  wait_settle
fi

echo ""
echo "done. Now point the dispatcher at it:"
echo "  set RAILBACK_EXTRACTOR_FUNCTION=$FN in scripts/environment.json, then re-run scripts/deploy-single.sh --env-only"
