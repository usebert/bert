import { useCallback, useEffect, useState } from "react";
import { KioskMode, type KioskStatus } from "../../native/kioskMode";
import { isCapacitorNativeApp } from "../../utils/debugUiVisibility";
import {
  isTabletKioskEnabled,
  setTabletKioskEnabled,
} from "../../utils/tabletKioskStorage";
import { applyNativeKioskChrome, clearNativeKioskChrome } from "../../hooks/useTabletKiosk";

type Props = {
  slatePrimaryCtaInteract: string;
  onChanged?: () => void;
};

export function TabletKioskGodmodePanel({ slatePrimaryCtaInteract, onChanged }: Props) {
  const [enabled, setEnabled] = useState(() => isTabletKioskEnabled());
  const [status, setStatus] = useState<KioskStatus | null>(null);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [showExitHelp, setShowExitHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!isCapacitorNativeApp()) {
      return;
    }
    try {
      const next = await KioskMode.getStatus();
      setStatus(next);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [enabled, refreshStatus]);

  if (!isCapacitorNativeApp()) {
    return null;
  }

  const handleEnable = async () => {
    setBusy(true);
    setLockMessage(null);
    try {
      setTabletKioskEnabled(true);
      setEnabled(true);
      await applyNativeKioskChrome();
      const lock = await KioskMode.startLockTask();
      if (!lock.started && lock.message) {
        setLockMessage(lock.message);
      }
      await refreshStatus();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    const confirmed = window.confirm(
      "Disable tablet kiosk mode on this device?\n\nStaff will see system navigation bars again. Android Home / Recents may leave BERT unless Screen Pinning or MDM kiosk is configured.",
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setLockMessage(null);
    try {
      setTabletKioskEnabled(false);
      setEnabled(false);
      await clearNativeKioskChrome();
      await refreshStatus();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">Kiosk mode (Android tablet)</p>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Keeps BERT full-screen on this tablet, hides system bars where possible, and blocks the back button from
        closing the app. Log out still returns to the BERT sign-in screen. This is stored on the device only.
      </p>

      <p className="mt-3 text-xs leading-5 text-amber-900 rounded-2xl border border-amber-100 bg-amber-50/80 px-3 py-2">
        App code cannot fully block Android Home, Recents, or Settings. For true OS lockdown use Screen Pinning,
        Android Enterprise / MDM kiosk, or Device Owner provisioning (see deployment runbook).
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span className="font-semibold text-slate-900">Device setting:</span>
        <span
          className={[
            "rounded-full px-3 py-1 text-xs font-semibold",
            enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700",
          ].join(" ")}
        >
          {enabled ? "Enabled" : "Disabled"}
        </span>
        {status?.lockTaskActive ? (
          <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
            Lock task active
          </span>
        ) : (
          <span className="text-xs text-slate-500">Lock task inactive (normal on unmanaged tablets)</span>
        )}
      </div>

      {lockMessage ? <p className="mt-2 text-sm text-amber-800">{lockMessage}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || enabled}
          onClick={() => void handleEnable()}
          className={`h-11 rounded-2xl bg-[#ea580c] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${slatePrimaryCtaInteract}`}
        >
          Enable tablet kiosk mode
        </button>
        <button
          type="button"
          disabled={busy || !enabled}
          onClick={() => void handleDisable()}
          className="h-11 rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Disable tablet kiosk mode
        </button>
        <button
          type="button"
          onClick={() => setShowExitHelp((current) => !current)}
          className="h-11 rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-800"
        >
          {showExitHelp ? "Hide exit instructions" : "Show exit instructions"}
        </button>
      </div>

      {showExitHelp ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-700">
          <p>
            <span className="font-semibold text-slate-900">Inside BERT:</span> sign in as Master → Setup → Open Initial
            Setup (Godmode) → Disable tablet kiosk mode (confirmation required).
          </p>
          <p>
            <span className="font-semibold text-slate-900">Screen Pinning (quick pilot):</span> open Recents → tap the
            BERT app icon → Pin. Unpin with Back + Recents together (varies by Android version).
          </p>
          <p>
            <span className="font-semibold text-slate-900">Production kiosk:</span> enroll tablets in Android Enterprise /
            MDM, assign a dedicated kiosk policy, and allowlist <span className="font-mono">co.usebert.app</span> for Lock
            Task Mode.
          </p>
          <p>
            <span className="font-semibold text-slate-900">ADB (lab only):</span>{" "}
            <span className="font-mono text-xs">dpm set-lock-task-packages … co.usebert.app</span> requires Device Owner
            setup — not for everyday operator use.
          </p>
        </div>
      ) : null}
    </section>
  );
}
