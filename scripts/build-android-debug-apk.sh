#!/usr/bin/env bash
# Full Android debug APK pipeline from repo root.
# Requires: npm install (node_modules for Vite/tsc and Capacitor CLI), JDK on PATH, Android SDK for Gradle.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# shellcheck source=./bump-android-build.sh
source "${SCRIPT_DIR}/bump-android-build.sh"
bump_android_build "$ROOT"

if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "ERROR: A working JDK is required (java on PATH that runs java -version). On macOS, install a JDK (e.g. Temurin) if you only see the /usr/bin/java stub."
  exit 1
fi

echo "==> Building web app (npm run build)"
npm run build

echo "==> Syncing Capacitor Android (npx cap sync android)"
npx cap sync android

echo "==> Assembling debug APK (./gradlew assembleDebug)"
(cd android && ./gradlew assembleDebug)

APK="${ROOT}/android/app/build/outputs/apk/debug/app-debug.apk"
if [[ -f "$APK" ]]; then
  copy_android_apk_with_build_number "$APK" "bert-debug" "$BERT_ANDROID_BUILD_NUMBER"
else
  echo "ERROR: Expected APK missing at ${APK}"
  exit 1
fi
