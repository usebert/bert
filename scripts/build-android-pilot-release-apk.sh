#!/usr/bin/env bash
# Paid-pilot Android release APK: production web bundle + hosted API, no demo/debug UI flags.
# Output: ~/Desktop/bert-pilot-release-build<N>.apk (unsigned unless android/keystore.properties is set)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# shellcheck source=./bump-android-build.sh
source "${SCRIPT_DIR}/bump-android-build.sh"
bump_android_build "$ROOT"

if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "ERROR: A working JDK is required (java on PATH that runs java -version)."
  exit 1
fi

export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.usebert.co.uk}"
unset VITE_SHOW_DEBUG_UI VITE_ENABLE_DEMO_LOGIN VITE_DEMO_USER_PASSWORD

echo "==> Building web app (VITE_API_BASE_URL=${VITE_API_BASE_URL}, no debug/demo flags)"
npm run build

echo "==> Verifying pilot dist bundle (verify:auth)"
BERT_VERIFY_PILOT_DIST=1 npm run verify:auth

echo "==> Syncing Capacitor Android (npx cap sync android)"
npx cap sync android

echo "==> Assembling release APK (./gradlew assembleRelease)"
(cd android && ./gradlew assembleRelease)

APK=""
if [[ -f "${ROOT}/android/app/build/outputs/apk/release/app-release.apk" ]]; then
  APK="${ROOT}/android/app/build/outputs/apk/release/app-release.apk"
elif [[ -f "${ROOT}/android/app/build/outputs/apk/release/app-release-unsigned.apk" ]]; then
  APK="${ROOT}/android/app/build/outputs/apk/release/app-release-unsigned.apk"
  echo "==> Note: release APK is unsigned (add android/keystore.properties for a signed app-release.apk)."
fi

if [[ -n "$APK" && -f "$APK" ]]; then
  copy_android_apk_with_build_number "$APK" "bert-pilot-release" "$BERT_ANDROID_BUILD_NUMBER"
else
  echo "ERROR: No release APK found under android/app/build/outputs/apk/release/"
  exit 1
fi
