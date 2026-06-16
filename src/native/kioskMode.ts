import { registerPlugin } from "@capacitor/core";

export type KioskLockTaskResult = {
  started: boolean;
  message?: string;
};

export type KioskStatus = {
  lockTaskActive: boolean;
  lockTaskMode: number;
};

export interface KioskModePlugin {
  applyImmersive(): Promise<void>;
  clearImmersive(): Promise<void>;
  startLockTask(): Promise<KioskLockTaskResult>;
  stopLockTask(): Promise<{ stopped: boolean; message?: string }>;
  getStatus(): Promise<KioskStatus>;
}

export const KioskMode = registerPlugin<KioskModePlugin>("KioskMode", {
  web: () => import("./kioskMode.web").then((module) => new module.KioskModeWeb()),
});
