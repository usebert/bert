import type { KioskModePlugin, KioskLockTaskResult, KioskStatus } from "./kioskMode";

/** Web builds: kiosk is a no-op (browser stays normal). */
export class KioskModeWeb implements KioskModePlugin {
  async applyImmersive(): Promise<void> {}

  async clearImmersive(): Promise<void> {}

  async startLockTask(): Promise<KioskLockTaskResult> {
    return { started: false, message: "Lock task is only available on Android." };
  }

  async stopLockTask(): Promise<{ stopped: boolean; message?: string }> {
    return { stopped: true };
  }

  async getStatus(): Promise<KioskStatus> {
    return { lockTaskActive: false, lockTaskMode: 0 };
  }
}
