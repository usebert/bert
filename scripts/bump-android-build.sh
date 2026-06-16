#!/usr/bin/env bash
# Bump monotonic Android pilot build number, sync Gradle versionCode, export Vite env for in-app label.
# Source from APK build scripts:  source "$(dirname "$0")/bump-android-build.sh" && bump_android_build

set -euo pipefail

bump_android_build() {
  local root="${1:-}"
  if [[ -z "$root" ]]; then
    echo "bump_android_build: repo root path required" >&2
    return 1
  fi

  local props="${root}/android/pilot-build.properties"
  if [[ ! -f "$props" ]]; then
    echo "buildNumber=0" >"$props"
  fi

  local current
  current="$(grep -E '^buildNumber=' "$props" | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
  if [[ -z "$current" || ! "$current" =~ ^[0-9]+$ ]]; then
    current=0
  fi

  BERT_ANDROID_BUILD_NUMBER=$((current + 1))
  BERT_ANDROID_BUILD_TIME="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  BERT_ANDROID_BUILD_GIT_SHA=""
  if command -v git >/dev/null 2>&1 && git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    BERT_ANDROID_BUILD_GIT_SHA="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || true)"
  fi

  cat >"$props" <<EOF
# Incremented by scripts/bump-android-build.sh on each APK build (committed to git).
buildNumber=${BERT_ANDROID_BUILD_NUMBER}
builtAt=${BERT_ANDROID_BUILD_TIME}
gitSha=${BERT_ANDROID_BUILD_GIT_SHA}
EOF

  export VITE_ANDROID_PILOT_BUILD_NUMBER="${BERT_ANDROID_BUILD_NUMBER}"
  export VITE_ANDROID_PILOT_BUILD_TIME="${BERT_ANDROID_BUILD_TIME}"
  export VITE_ANDROID_PILOT_BUILD_GIT_SHA="${BERT_ANDROID_BUILD_GIT_SHA}"

  echo "==> BERT Android build number: ${BERT_ANDROID_BUILD_NUMBER} (versionName pilot.${BERT_ANDROID_BUILD_NUMBER})"
  if [[ -n "$BERT_ANDROID_BUILD_GIT_SHA" ]]; then
    echo "==> Git commit: ${BERT_ANDROID_BUILD_GIT_SHA}"
  fi
}

copy_android_apk_with_build_number() {
  local src="$1"
  local desktop_basename="$2"
  local build_number="${3:-${BERT_ANDROID_BUILD_NUMBER:-}}"

  if [[ -z "$build_number" ]]; then
    echo "copy_android_apk_with_build_number: build number missing" >&2
    return 1
  fi
  if [[ ! -f "$src" ]]; then
    echo "copy_android_apk_with_build_number: APK missing at ${src}" >&2
    return 1
  fi

  local numbered="${HOME}/Desktop/${desktop_basename}-build${build_number}.apk"
  local latest="${HOME}/Desktop/${desktop_basename}.apk"
  cp -f "$src" "$numbered"
  cp -f "$src" "$latest"
  echo "==> APK (numbered): ${numbered}"
  echo "==> APK (latest alias): ${latest}"
}
