import { storageKeys } from "../config/storageKeys";
import { isCapacitorNativeApp } from "./debugUiVisibility";

/** Pilot tablets: kiosk on by default until Master disables it in Godmode. */
export function isTabletKioskEnabled(): boolean {
  if (!isCapacitorNativeApp()) {
    return false;
  }
  try {
    const raw = window.localStorage.getItem(storageKeys.tabletKioskEnabled);
    if (raw === "false") {
      return false;
    }
    if (raw === "true") {
      return true;
    }
    return true;
  } catch {
    return true;
  }
}

export function setTabletKioskEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(storageKeys.tabletKioskEnabled, enabled ? "true" : "false");
  } catch {
    /* ignore */
  }
}
