/**
 * Presentation-only guard for company switching.
 * Queued offline submissions are namespaced and must not block switching.
 */
export type ShellUnsavedSnapshot = {
  onAuditCompletionScreen: boolean;
  hasActiveAuditDraft: boolean;
  scheduleEditorOpen: boolean;
};

export function hasShellUnsavedWork(snapshot: ShellUnsavedSnapshot): boolean {
  return snapshot.onAuditCompletionScreen || snapshot.hasActiveAuditDraft || snapshot.scheduleEditorOpen;
}

export function confirmDiscardShellUnsavedWork(): boolean {
  if (typeof window === "undefined") return true;
  return window.confirm("You have unsaved changes on this screen. Switch company and discard them?");
}
