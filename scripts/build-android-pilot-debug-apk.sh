#!/usr/bin/env bash
# Paid-pilot Android debug APK: production web bundle + hosted API, no demo/debug UI flags.
# Output: ~/Desktop/bert-pilot-debug.apk

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "ERROR: A working JDK is required (java on PATH that runs java -version)."
  exit 1
fi

export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.usebert.co.uk}"
# Explicitly clear client demo/debug flags so a local .env cannot leak into the APK bundle.
unset VITE_SHOW_DEBUG_UI VITE_ENABLE_DEMO_LOGIN VITE_GODMODE_PASSWORD VITE_DEMO_USER_PASSWORD

echo "==> Building web app (VITE_API_BASE_URL=${VITE_API_BASE_URL}, no debug/demo flags)"
npm run build

echo "==> Verifying pilot dist bundle (verify:auth)"
BERT_VERIFY_PILOT_DIST=1 npm run verify:auth

echo "==> Syncing Capacitor Android (npx cap sync android)"
npx cap sync android

echo "==> Assembling debug APK (./gradlew assembleDebug)"
(cd android && ./gradlew assembleDebug)

APK="${ROOT}/android/app/build/outputs/apk/debug/app-debug.apk"
DEST="${HOME}/Desktop/bert-pilot-debug.apk"
if [[ -f "$APK" ]]; then
  echo "==> Copying pilot debug APK to ${DEST}"
  cp -f "$APK" "$DEST"
  echo "==> Success: ${DEST}"
else
  echo "ERROR: Expected APK missing at ${APK}"
  exit 1
fi
