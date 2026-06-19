import { isCapacitorNativeApp } from "./debugUiVisibility";

function readBuildNumber(): string | null {
  const raw = String(import.meta.env.VITE_ANDROID_PILOT_BUILD_NUMBER ?? "").trim();
  return raw && /^\d+$/.test(raw) ? raw : null;
}

/** Shown on native Android to identify the installed pilot APK build. */
export function getAndroidPilotBuildLabel(): string | null {
  if (!isCapacitorNativeApp()) {
    return null;
  }
  const build = readBuildNumber();
  if (!build) {
    return null;
  }
  return `Build ${build}`;
}

export function getAndroidPilotBuildDetail(): string | null {
  if (!isCapacitorNativeApp()) {
    return null;
  }
  const build = readBuildNumber();
  if (!build) {
    return null;
  }
  const time = String(import.meta.env.VITE_ANDROID_PILOT_BUILD_TIME ?? "").trim();
  const sha = String(import.meta.env.VITE_ANDROID_PILOT_BUILD_GIT_SHA ?? "").trim();
  const parts = [`Pilot APK build ${build}`];
  if (time) {
    parts.push(time);
  }
  if (sha) {
    parts.push(sha);
  }
  return parts.join(" · ");
}
