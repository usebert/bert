import type { Role } from "../permissions";
import { getRolePermissions } from "../permissions";
import type { SyncQueueItem, SyncStatus } from "../types/sync";
import { EmptyPanel, MiniMetric } from "../components/dashboard/DashboardPrimitives";
import { darkPanelBody, darkPanelEyebrow, darkPanelShell, darkPanelTitleLg } from "../styles/darkPanel";
import { AnimatedButton } from "../components/animation/AnimatedButton";
import { StatusPulse, type SyncVisualState } from "../components/animation/StatusPulse";
import { slatePrimaryCtaInteract } from "../styles/interactions";

function queueItemVisualState(status: SyncStatus): SyncVisualState {
  if (status === "Syncing") return "syncing";
  if (status === "Synced") return "synced";
  if (status === "Failed" || status === "Conflict") return "failed";
  if (status === "Pending Sync") return "waiting";
  return "idle";
}

function syncTrustLabel(status: SyncStatus): string {
  if (status === "Pending Sync") return "Queued";
  if (status === "Syncing") return "Syncing";
  if (status === "Synced") return "Synced";
  if (status === "Failed") return "Failed";
  if (status === "Conflict") return "Failed (conflict)";
  return status;
}

function queueItemTypeLabel(itemType: string): string {
  if (itemType === "auditCompletion") return "Check completion";
  if (itemType === "auditSubmission") return "Audit submission";
  if (itemType === "incidentReport") return "Incident report";
  if (itemType === "actionUpdate") return "Action update";
  if (itemType === "briefingCreate") return "Briefing created";
  if (itemType === "briefingAck") return "Briefing acknowledgement";
  return "Queued item";
}

function queueTimeLabel(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

function SyncCentreAppIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const shared = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
  if (name === "sync") {
    return (
      <svg {...shared}>
        <path d="M3 12a8 8 0 0 1 13.66-5.66L19 8" />
        <path d="M21 12a8 8 0 0 1-13.66 5.66L5 16" />
        <path d="M19 3v5h-5" />
        <path d="M5 21v-5h5" />
      </svg>
    );
  }
  return null;
}

export function SyncCentreScreen({
  currentUser,
  syncQueue,
  offlineQueueCount,
  onRetryItem,
  onForceSyncItem,
  onDismissItem,
  onSyncAll,
  syncingAll,
}: {
  currentUser: { username: string; password: string; role: Role; name: string };
  syncQueue: SyncQueueItem[];
  offlineQueueCount: number;
  onRetryItem: (localId: string) => void;
  onForceSyncItem: (localId: string) => void;
  onDismissItem?: (localId: string) => void;
  onSyncAll?: () => void;
  syncingAll?: boolean;
}) {
  const permissions = getRolePermissions(currentUser.role);
  const waitingCount = syncQueue.filter((item) => item.status === "Pending Sync" || item.status === "Syncing").length;
  const failedCount = syncQueue.filter((item) => item.status === "Failed" || item.status === "Conflict").length;
  const hasWaitingWork = waitingCount > 0 || offlineQueueCount > 0;
  const hasRetryableWork = hasWaitingWork || failedCount > 0;

  return (
    <div className="space-y-4">
      <section className={darkPanelShell}>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white">
            <SyncCentreAppIcon name="sync" className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className={darkPanelEyebrow}>Operational trust</p>
            <h2 className={darkPanelTitleLg}>Sync Centre</h2>
            <p className={["mt-2", darkPanelBody].join(" ")}>
              Field work, evidence, and admin edits stay visible here until they reach your company sheet in Google Drive—so you always know what still needs the network.
            </p>
            {hasRetryableWork && onSyncAll ? (
              <AnimatedButton
                type="button"
                onClick={onSyncAll}
                disabled={syncingAll}
                className={`mt-4 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 ${slatePrimaryCtaInteract}`}
              >
                {syncingAll ? "Syncing…" : failedCount > 0 && waitingCount === 0 ? "Retry all" : "Sync now"}
              </AnimatedButton>
            ) : null}
          </div>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <MiniMetric label="Waiting" value={String(waitingCount)} />
        <MiniMetric label="Failed" value={String(failedCount)} />
      </section>
      {syncQueue.length === 0 ? (
        <EmptyPanel
          title="All synced"
          text="Nothing is waiting to sync right now. Items appear here when field work is queued or needs a retry."
        />
      ) : (
        <div className="space-y-3">
          {syncQueue.map((item) => (
            <section key={item.id} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{queueItemTypeLabel(item.itemType)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Created {queueTimeLabel(item.createdAt)}
                    {item.attemptedAt ? ` · Last attempt ${queueTimeLabel(item.attemptedAt)}` : ""} · Updated {queueTimeLabel(item.updatedAt)}
                  </p>
                  {item.lastError ? <p className="mt-2 text-xs font-semibold text-rose-600">{item.lastError}</p> : null}
                </div>
                <StatusPulse state={queueItemVisualState(item.status)} label={syncTrustLabel(item.status)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">Retries {item.retryCount}</div>
                {item.status === "Pending Sync" && (
                  <AnimatedButton type="button" onClick={() => onRetryItem(item.localId)} className={`rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white ${slatePrimaryCtaInteract}`}>
                    Sync now
                  </AnimatedButton>
                )}
                {(item.status === "Failed" || item.status === "Conflict") && (
                  <AnimatedButton type="button" onClick={() => onRetryItem(item.localId)} className={`rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white ${slatePrimaryCtaInteract}`}>
                    Retry failed
                  </AnimatedButton>
                )}
                {(item.status === "Failed" || item.status === "Conflict") && onDismissItem && (
                  <button
                    type="button"
                    onClick={() => onDismissItem(item.localId)}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                  >
                    Dismiss failed item
                  </button>
                )}
                {permissions.canRepairWorkspace && <button onClick={() => onForceSyncItem(item.localId)} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">Force sync</button>}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
