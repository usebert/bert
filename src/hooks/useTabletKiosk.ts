import { useEffect, useRef } from "react";
import { App } from "@capacitor/app";
import { KioskMode } from "../native/kioskMode";
import { isCapacitorNativeApp } from "../utils/debugUiVisibility";
import { isTabletKioskEnabled } from "../utils/tabletKioskStorage";

async function applyNativeKioskChrome(): Promise<void> {
  if (!isCapacitorNativeApp() || !isTabletKioskEnabled()) {
    return;
  }
  await KioskMode.applyImmersive();
  const lock = await KioskMode.startLockTask();
  if (!lock.started && lock.message) {
    console.info("[bert kiosk]", lock.message);
  }
}

async function clearNativeKioskChrome(): Promise<void> {
  if (!isCapacitorNativeApp()) {
    return;
  }
  await KioskMode.stopLockTask().catch(() => undefined);
  await KioskMode.clearImmersive().catch(() => undefined);
}

/**
 * Android tablet pilot: immersive full-screen, consume hardware back (stay in BERT),
 * best-effort Lock Task when the device allows it.
 */
export function useTabletKiosk(kioskEnabled: boolean) {
  const kioskRef = useRef(kioskEnabled);
  kioskRef.current = kioskEnabled;

  useEffect(() => {
    if (!isCapacitorNativeApp()) {
      return;
    }

    let cancelled = false;

    const syncChrome = async () => {
      if (cancelled) {
        return;
      }
      if (kioskRef.current) {
        await applyNativeKioskChrome();
      } else {
        await clearNativeKioskChrome();
      }
    };

    void syncChrome();

    const resumeSub = App.addListener("resume", () => {
      void syncChrome();
    });

    const backSub = App.addListener("backButton", ({ canGoBack }) => {
      if (!kioskRef.current) {
        return;
      }
      if (canGoBack) {
        window.history.back();
      }
    });

    return () => {
      cancelled = true;
      void resumeSub.then((handle) => handle.remove());
      void backSub.then((handle) => handle.remove());
    };
  }, [kioskEnabled]);
}

export { applyNativeKioskChrome, clearNativeKioskChrome };
