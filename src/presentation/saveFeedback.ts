/** Standard customer-facing save and sync feedback copy. */
export const SAVE_FEEDBACK = {
  saving: "Saving…",
  saved: "Saved",
  addedToQueue: "Added to queue",
  syncing: "Syncing…",
  awaitingSync: "Awaiting sync",
  syncFailed: "Sync failed",
  retry: "Retry",
} as const;

export type SaveFeedbackKey = keyof typeof SAVE_FEEDBACK;

export function saveFeedbackLabel(key: SaveFeedbackKey): string {
  return SAVE_FEEDBACK[key];
}
