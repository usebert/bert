/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Short app name in UI chrome (default `bert.` in code). */
  readonly VITE_APP_NAME?: string;
  /** When `"true"`, shows role switcher, layout/landscape preview, demo badges, dashboard layout tools. */
  readonly VITE_SHOW_DEBUG_UI?: string;
  readonly VITE_SHOW_ADMIN_DEBUG_UI?: string;
  readonly VITE_ENABLE_DEMO_LOGIN?: string;
  /** When set (e.g. https://api.usebert.co.uk), browser and Capacitor builds call that host for `/api` and `/auth` routes. Omit for same-origin. */
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_GODMODE_USERNAME?: string;
  readonly VITE_GODMODE_PASSWORD?: string;
  /** Set by scripts/bump-android-build.sh when assembling pilot APKs. */
  readonly VITE_ANDROID_PILOT_BUILD_NUMBER?: string;
  readonly VITE_ANDROID_PILOT_BUILD_TIME?: string;
  readonly VITE_ANDROID_PILOT_BUILD_GIT_SHA?: string;
}
