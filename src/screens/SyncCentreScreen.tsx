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
}: {
  currentUser: { username: string; password: string; role: Role; name: string };
  syncQueue: SyncQueueItem[];
  offlineQueueCount: number;
  onRetryItem: (localId: string) => void;
  onForceSyncItem: (localId: string) => void;
}) {
  const permissions = getRolePermissions(currentUser.role);
  return (
    <div className="space-y-4">
      <section className={darkPanelShell}>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white">
            <SyncCentreAppIcon name="sync" className="h-5 w-5" />
          </div>
          <div>
            <p className={darkPanelEyebrow}>Operational trust</p>
            <h2 className={darkPanelTitleLg}>Sync Centre</h2>
            <p className={["mt-2", darkPanelBody].join(" ")}>
              Field work, evidence, and admin edits stay visible here until they reach your company sheet in Google Drive—so you always know what still needs the network.
            </p>
          </div>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <MiniMetric label="Queued offline submissions" value={String(offlineQueueCount)} />
        <MiniMetric label="Tracked sync items" value={String(syncQueue.length)} />
      </section>
      {syncQueue.length === 0 ? (
        <EmptyPanel
          title="No sync items waiting"
          text="All clear — nothing queued right now. Items appear when field or admin work is waiting to upload or retry to your company sheet."
        />
      ) : (
        <div className="space-y-3">
          {syncQueue.map((item) => (
            <section key={item.id} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{item.itemType}</p>
                  <p className="mt-1 text-xs text-slate-500">Reference: {item.localId}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Created {item.createdAt}
                    {item.attemptedAt ? ` · Last attempt ${item.attemptedAt}` : ""} · Updated {item.updatedAt}
                  </p>
                  {item.lastError ? <p className="mt-2 text-xs font-semibold text-rose-600">{item.lastError}</p> : null}
                </div>
                <StatusPulse state={queueItemVisualState(item.status)} label={syncTrustLabel(item.status)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">Retries {item.retryCount}</div>
                {(item.status === "Failed" || item.status === "Conflict") && (
                  <AnimatedButton type="button" onClick={() => onRetryItem(item.localId)} className={`rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white ${slatePrimaryCtaInteract}`}>
                    Retry sync
                  </AnimatedButton>
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
