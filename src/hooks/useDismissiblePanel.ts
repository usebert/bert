import { useCallback, useEffect, useState } from "react";

function readDismissed(storageKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(storageKey: string, dismissed: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (dismissed) {
      window.localStorage.setItem(storageKey, "1");
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/** Persist dismiss state per user/company scope without blocking the page. */
export function useDismissiblePanel(storageKey: string) {
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey));

  useEffect(() => {
    setDismissed(readDismissed(storageKey));
  }, [storageKey]);

  const dismiss = useCallback(() => {
    writeDismissed(storageKey, true);
    setDismissed(true);
  }, [storageKey]);

  const reset = useCallback(() => {
    writeDismissed(storageKey, false);
    setDismissed(false);
  }, [storageKey]);

  return { dismissed, dismiss, reset };
}

export function scopedDismissKey(prefix: string, companyId: string, userId: string, panelId: string): string {
  const company = companyId.trim() || "none";
  const user = userId.trim().toLowerCase() || "anonymous";
  return `${prefix}:${company}:${user}:${panelId}`;
}
