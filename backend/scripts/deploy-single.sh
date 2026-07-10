#!/usr/bin/env bash
# deploy-single.sh — deploy the whole RailBack backend as ONE Lambda behind a
# Function URL. This is the "option a" student-sandbox path: no API Gateway, no
# create-function, no IAM changes — we only update code + config on a pre-created
# function and expose it via a Lambda Function URL.
#
# The single function runs lambdas/_deploy/src/index.ts, which dispatches
# /auth,/users,/admin to the real handlers and exposes /_internal/* for the
# trigger-driven work (email sweep, webhook replay, anonymisation, sepa reports).
#
# Prereqs:
#   - AWS creds: `export AWS_PROFILE=railback` (region eu-north-1).
#   - The target function already exists and you can update it (default s241539).
#   - Env values ready (see ENV below). Put secrets in environment.json, NOT here.
#
# Usage:
#   scripts/deploy-single.sh                 # build + config + code + URL, confirm first
#   RAILBACK_FN=s241539 scripts/deploy-single.sh
#   scripts/deploy-single.sh --env-only      # just push env vars from environment.json
#   scripts/deploy-single.sh --code-only     # just rebuild + push code
#   scripts/deploy-single.sh --yes           # skip confirmation
#
# Env vars: pass them via a file `environment.json` next to this script:
#   { "Variables": { "RAILBACK_STORAGE": "ddb", "RAILBACK_DDB_TABLE": "RailBack", ... } }
# See environment.example.json. Do NOT commit environment.json (holds secrets).
set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BACKEND_ROOT"

FN="${RAILBACK_FN:-s241539}"
REGION="${RAILBACK_DEPLOY_REGION:-${AWS_REGION:-eu-north-1}}"
ZIP="$BACKEND_ROOT/dist-lambdas/_deploy.zip"
ENV_FILE="$BACKEND_ROOT/scripts/environment.json"

DO_CONFIG=1; DO_ENV=1; DO_CODE=1; DO_URL=1; CONFIRM=1
for arg in "$@"; do
  case "$arg" in
    --env-only)  DO_CONFIG=0; DO_CODE=0; DO_URL=0 ;;
    --code-only) DO_CONFIG=0; DO_ENV=0;  DO_URL=0 ;;
    --yes|-y)    CONFIRM=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

command -v aws >/dev/null || { echo "aws cli not found" >&2; exit 1; }
aws sts get-caller-identity >/dev/null 2>&1 || {
  echo "!! no AWS credentials. Run: export AWS_PROFILE=railback" >&2; exit 1; }

echo "== RailBack single-function deploy =="
echo "function: $FN   region: $REGION"
[[ $CONFIRM -eq 1 ]] && { read -r -p "Proceed against '$FN' in $REGION? [y/N] " a; [[ "$a" == y || "$a" == Y ]] || { echo aborted; exit 1; }; }

wait_settle() { aws lambda wait function-updated --region "$REGION" --function-name "$FN"; }

if [[ $DO_CONFIG -eq 1 ]]; then
  echo ">> runtime / handler / memory / timeout"
  aws lambda update-function-configuration --region "$REGION" --function-name "$FN" \
    --runtime nodejs20.x --handler index.handler --memory-size 512 --timeout 30 \
    --query '{Runtime:Runtime,Handler:Handler,Mem:MemorySize,Timeout:Timeout}' --output json
  wait_settle
fi

if [[ $DO_ENV -eq 1 ]]; then
  [[ -f "$ENV_FILE" ]] || { echo "!! $ENV_FILE missing. Copy scripts/environment.example.json → environment.json and fill it." >&2; exit 1; }
  echo ">> environment variables (from environment.json)"
  aws lambda update-function-configuration --region "$REGION" --function-name "$FN" \
    --environment "file://$ENV_FILE" --query 'Environment.Variables | keys(@)' --output json
  wait_settle
fi

if [[ $DO_CODE -eq 1 ]]; then
  echo ">> build zip"
  SKIP_PYTHON=1 scripts/build-lambdas.sh _deploy
  echo ">> upload code"
  aws lambda update-function-code --region "$REGION" --function-name "$FN" \
    --zip-file "fileb://$ZIP" --publish \
    --query '{Fn:FunctionName,Size:CodeSize,State:LastUpdateStatus}' --output json
  wait_settle
fi

if [[ $DO_URL -eq 1 ]]; then
  echo ">> ensure Function URL (public, CORS *)"
  CORS='AllowOrigins=*,AllowMethods=*,AllowHeaders=content-type:authorization:x-internal-secret'
  aws lambda create-function-url-config --region "$REGION" --function-name "$FN" \
    --auth-type NONE --cors "$CORS" >/dev/null 2>&1 \
  || aws lambda update-function-url-config --region "$REGION" --function-name "$FN" \
    --auth-type NONE --cors "$CORS" >/dev/null 2>&1 || true
fi

URL="$(aws lambda get-function-url-config --region "$REGION" --function-name "$FN" --query FunctionUrl --output text 2>/dev/null || true)"
echo ""
echo "done. Function URL: ${URL:-<none>}"
[[ -n "$URL" ]] && {
  echo "smoke test:"
  echo "  curl -s ${URL}health"
  echo "  curl -s -X POST ${URL}auth/login -H 'content-type: application/json' -d '{\"email\":\"...\",\"password\":\"...\"}'"
}
