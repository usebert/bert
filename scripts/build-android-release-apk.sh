#!/usr/bin/env bash
# Release Android APK from repo root (unsigned or keystore-signed per android/keystore.properties).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# shellcheck source=./bump-android-build.sh
source "${SCRIPT_DIR}/bump-android-build.sh"
bump_android_build "$ROOT"

if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "ERROR: A working JDK is required (java on PATH)."
  exit 1
fi

echo "==> Building web app (npm run build)"
npm run build

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
  echo "==> Release APK: ${APK}"
  copy_android_apk_with_build_number "$APK" "bert-release" "$BERT_ANDROID_BUILD_NUMBER"
else
  echo "ERROR: No release APK found under android/app/build/outputs/apk/release/"
  exit 1
fi
