import { useCallback, useEffect, useMemo, useState } from "react";
import {
  bertBtnInteractive,
  bertRowInteractive,
  bertSectionEnter,
  bertTabPanel,
  bertTabTrigger,
} from "../components/animation/animationClasses";
import type { Role } from "../permissions";
import { canManageBriefings } from "../permissions";
import type {
  BriefingCreateInput,
  BriefingPriority,
  BriefingRecipientRecord,
  BriefingTargetMode,
  BriefingType,
} from "../types/briefings";
import {
  acknowledgeBriefingItem,
  fetchBriefingsTracker,
  fetchMyBriefings,
  openBriefingItem,
  readBriefingItem,
  replyToBriefingItem,
  sendBriefing,
  signBriefingItem,
} from "../services/briefingsService";

type BriefingsTab = "mine" | "send" | "tracker";

type Props = {
  role: Role;
  companyFolderId: string;
  initialBriefingId?: string;
  onBack?: () => void;
};

const BRIEFING_TYPES: BriefingType[] = ["Policy", "Toolbox Talk", "Notice", "Training", "Other"];
const PRIORITIES: BriefingPriority[] = ["Normal", "Important", "Urgent"];
const TARGET_MODES: Array<{ id: BriefingTargetMode; label: string }> = [
  { id: "everyone", label: "Everyone" },
  { id: "role", label: "By role" },
  { id: "area", label: "By area" },
  { id: "department", label: "By department" },
  { id: "users", label: "Specific people" },
];

function actionLabelForItem(item: BriefingRecipientRecord): string {
  const briefing = item.briefing;
  if (!briefing) return "Open";
  if (briefing.requiresSignature && !item.signedAt) return "Sign";
  if (briefing.requiresAcknowledgement && !item.acknowledgedAt) return "Acknowledge";
  if (briefing.requiresReply && !item.replyAt) return "Reply";
  if (briefing.requiresRead && !item.readAt) return "Read";
  return "Open";
}

export function BriefingsScreen({ role, companyFolderId, initialBriefingId, onBack }: Props) {
  const canManage = canManageBriefings(role);
  const [tab, setTab] = useState<BriefingsTab>("mine");
  const [mine, setMine] = useState<BriefingRecipientRecord[]>([]);
  const [tracker, setTracker] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(initialBriefingId || "");
  const [signatureName, setSignatureName] = useState("");
  const [replyText, setReplyText] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendMessage, setSendMessage] = useState("");

  const [form, setForm] = useState<BriefingCreateInput>({
    title: "",
    type: "Notice",
    priority: "Normal",
    message: "",
    targetMode: "everyone",
    requiresRead: true,
    requiresAcknowledgement: false,
    requiresSignature: false,
    requiresReply: false,
    renewalFrequency: "None",
  });

  const loadMine = useCallback(async () => {
    if (!companyFolderId) return;
    setLoading(true);
    setError("");
    try {
      const result = await fetchMyBriefings(companyFolderId);
      setMine(result.items || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load briefings.");
    } finally {
      setLoading(false);
    }
  }, [companyFolderId]);

  const loadTracker = useCallback(async () => {
    if (!companyFolderId || !canManage) return;
    setLoading(true);
    setError("");
    try {
      const result = await fetchBriefingsTracker(companyFolderId);
      setTracker((result.items || []) as Array<Record<string, unknown>>);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load tracker.");
    } finally {
      setLoading(false);
    }
  }, [canManage, companyFolderId]);

  useEffect(() => {
    if (tab === "mine") {
      void loadMine();
    } else if (tab === "tracker") {
      void loadTracker();
    }
  }, [tab, loadMine, loadTracker]);

  useEffect(() => {
    if (initialBriefingId) {
      setSelectedId(initialBriefingId);
      setTab("mine");
    }
  }, [initialBriefingId]);

  const selectedItem = useMemo(
    () => mine.find((item) => item.briefingId === selectedId) || null,
    [mine, selectedId],
  );

  async function runAction(action: "open" | "read" | "acknowledge" | "sign" | "reply") {
    if (!selectedId || !companyFolderId) return;
    setActionBusy(true);
    setError("");
    try {
      if (action === "open") await openBriefingItem(companyFolderId, selectedId);
      if (action === "read") await readBriefingItem(companyFolderId, selectedId);
      if (action === "acknowledge") await acknowledgeBriefingItem(companyFolderId, selectedId);
      if (action === "sign") await signBriefingItem(companyFolderId, selectedId, signatureName);
      if (action === "reply") await replyToBriefingItem(companyFolderId, selectedId, replyText);
      await loadMine();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update briefing.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSendBriefing(event: React.FormEvent) {
    event.preventDefault();
    if (!companyFolderId) return;
    setSendBusy(true);
    setSendMessage("");
    setError("");
    try {
      const result = await sendBriefing(companyFolderId, form);
      setSendMessage(`Sent to ${result.recipientCount ?? 0} recipients.`);
      setForm({
        title: "",
        type: "Notice",
        priority: "Normal",
        message: "",
        targetMode: "everyone",
        requiresRead: true,
        requiresAcknowledgement: false,
        requiresSignature: false,
        requiresReply: false,
        renewalFrequency: "None",
      });
      setTab("tracker");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send briefing.");
    } finally {
      setSendBusy(false);
    }
  }

  return (
    <div className={["mx-auto max-w-5xl space-y-6 p-4 pb-24", bertSectionEnter].join(" ")}>
      <header className="space-y-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className={["text-sm font-semibold text-slate-600", bertBtnInteractive].join(" ")}
          >
            ← Back
          </button>
        ) : null}
        <h1 className="text-2xl font-black text-slate-900">Briefings</h1>
        <p className="text-sm text-slate-600">Policies, toolbox talks, notices, and messages with read and sign tracking.</p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("mine")}
          className={[
            "rounded-xl px-4 py-2 text-sm font-semibold",
            bertTabTrigger,
            tab === "mine" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
          ].join(" ")}
        >
          My briefings
        </button>
        {canManage ? (
          <>
            <button
              type="button"
              onClick={() => setTab("send")}
              className={[
                "rounded-xl px-4 py-2 text-sm font-semibold",
                bertTabTrigger,
                tab === "send" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
              ].join(" ")}
            >
              Send briefing
            </button>
            <button
              type="button"
              onClick={() => setTab("tracker")}
              className={[
                "rounded-xl px-4 py-2 text-sm font-semibold",
                bertTabTrigger,
                tab === "tracker" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
              ].join(" ")}
            >
              Tracker
            </button>
          </>
        ) : null}
      </div>

      {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p> : null}
      {sendMessage ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{sendMessage}</p> : null}

      {tab === "mine" ? (
        <div key="mine" className={["grid gap-4 lg:grid-cols-2", bertTabPanel].join(" ")}>
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold text-slate-900">Assigned to you</h2>
            {loading && mine.length === 0 ? <p className="mt-3 text-sm text-slate-600">Loading…</p> : null}
            {!loading && mine.length === 0 ? <p className="mt-3 text-sm text-slate-600">No briefings assigned yet.</p> : null}
            <ul className="mt-3 space-y-2">
              {mine.map((item) => (
                <li key={item.briefingId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.briefingId)}
                    className={[
                      "w-full rounded-xl border px-3 py-3 text-left",
                      bertRowInteractive,
                      selectedId === item.briefingId ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white",
                    ].join(" ")}
                  >
                    <p className="font-semibold text-slate-900">{item.briefing?.title || item.briefingId}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {item.briefing?.type} · {item.status}
                      {item.briefing?.dueDate ? ` · Due ${item.briefing.dueDate}` : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold text-slate-900">Details</h2>
            {!selectedItem ? <p className="mt-3 text-sm text-slate-600">Select a briefing to open it.</p> : null}
            {selectedItem ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-slate-700">{selectedItem.briefing?.message || "No message provided."}</p>
                {selectedItem.briefing?.documentDriveLink ? (
                  <a
                    href={selectedItem.briefing.documentDriveLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-sm font-semibold text-blue-700 underline"
                  >
                    Open document{selectedItem.briefing.documentName ? `: ${selectedItem.briefing.documentName}` : ""}
                  </a>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void runAction("open")}
                    className={["rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white", bertBtnInteractive].join(" ")}
                  >
                    Open
                  </button>
                  {selectedItem.briefing?.requiresRead ? (
                    <button type="button" disabled={actionBusy} onClick={() => void runAction("read")} className="rounded-xl border px-3 py-2 text-xs font-semibold">
                      Read
                    </button>
                  ) : null}
                  {selectedItem.briefing?.requiresAcknowledgement ? (
                    <button type="button" disabled={actionBusy} onClick={() => void runAction("acknowledge")} className="rounded-xl border px-3 py-2 text-xs font-semibold">
                      Acknowledge
                    </button>
                  ) : null}
                  {selectedItem.briefing?.requiresSignature ? (
                    <>
                      <input
                        value={signatureName}
                        onChange={(event) => setSignatureName(event.target.value)}
                        placeholder="Signature name"
                        className="rounded-xl border px-3 py-2 text-xs"
                      />
                      <button type="button" disabled={actionBusy} onClick={() => void runAction("sign")} className="rounded-xl border px-3 py-2 text-xs font-semibold">
                        Sign
                      </button>
                    </>
                  ) : null}
                  {selectedItem.briefing?.requiresReply ? (
                    <>
                      <textarea
                        value={replyText}
                        onChange={(event) => setReplyText(event.target.value)}
                        placeholder="Your reply"
                        className="min-h-[4rem] w-full rounded-xl border px-3 py-2 text-xs"
                      />
                      <button type="button" disabled={actionBusy} onClick={() => void runAction("reply")} className="rounded-xl border px-3 py-2 text-xs font-semibold">
                        Reply
                      </button>
                    </>
                  ) : null}
                  {!selectedItem.briefing?.requiresRead &&
                  !selectedItem.briefing?.requiresAcknowledgement &&
                  !selectedItem.briefing?.requiresSignature &&
                  !selectedItem.briefing?.requiresReply ? (
                    <span className="text-xs text-slate-600">Action: {actionLabelForItem(selectedItem)}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === "send" && canManage ? (
        <form key="send" onSubmit={handleSendBriefing} className={["space-y-4 rounded-2xl border border-slate-200 bg-white p-4", bertTabPanel].join(" ")}>
          <h2 className="text-lg font-bold text-slate-900">Send briefing</h2>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Title</span>
            <input
              required
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              className="w-full rounded-xl border px-3 py-2"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-semibold">Type</span>
              <select
                value={form.type}
                onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as BriefingType }))}
                className="w-full rounded-xl border px-3 py-2"
              >
                {BRIEFING_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-semibold">Priority</span>
              <select
                value={form.priority}
                onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value as BriefingPriority }))}
                className="w-full rounded-xl border px-3 py-2"
              >
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Message</span>
            <textarea
              value={form.message}
              onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
              className="min-h-[6rem] w-full rounded-xl border px-3 py-2"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Due date</span>
            <input
              type="date"
              value={form.dueDate || ""}
              onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))}
              className="w-full rounded-xl border px-3 py-2"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Recipients</span>
            <select
              value={form.targetMode}
              onChange={(event) => setForm((prev) => ({ ...prev, targetMode: event.target.value as BriefingTargetMode }))}
              className="w-full rounded-xl border px-3 py-2"
            >
              {TARGET_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          {form.targetMode === "role" ? (
            <input
              placeholder="Roles (comma separated, e.g. Auditor, Manager)"
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  targetRoles: event.target.value.split(",").map((entry) => entry.trim()).filter(Boolean),
                }))
              }
              className="w-full rounded-xl border px-3 py-2"
            />
          ) : null}
          {form.targetMode === "users" ? (
            <input
              placeholder="Emails (comma separated)"
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  targetUserEmails: event.target.value.split(",").map((entry) => entry.trim()).filter(Boolean),
                }))
              }
              className="w-full rounded-xl border px-3 py-2"
            />
          ) : null}
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requiresRead} onChange={(event) => setForm((prev) => ({ ...prev, requiresRead: event.target.checked }))} />
              Require read confirmation
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.requiresAcknowledgement}
                onChange={(event) => setForm((prev) => ({ ...prev, requiresAcknowledgement: event.target.checked }))}
              />
              Require acknowledgement
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requiresSignature} onChange={(event) => setForm((prev) => ({ ...prev, requiresSignature: event.target.checked }))} />
              Require signature
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requiresReply} onChange={(event) => setForm((prev) => ({ ...prev, requiresReply: event.target.checked }))} />
              Require reply
            </label>
          </fieldset>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Document link (optional)</span>
            <input
              placeholder="Google Drive link"
              onChange={(event) => setForm((prev) => ({ ...prev, documentDriveLink: event.target.value }))}
              className="w-full rounded-xl border px-3 py-2"
            />
          </label>
          <button type="submit" disabled={sendBusy} className={["rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white", bertBtnInteractive].join(" ")}>
            {sendBusy ? "Sending…" : "Send briefing"}
          </button>
        </form>
      ) : null}

      {tab === "tracker" && canManage ? (
        <section key="tracker" className={["rounded-2xl border border-slate-200 bg-white p-4", bertTabPanel].join(" ")}>
          <h2 className="text-lg font-bold text-slate-900">Tracker</h2>
          {loading && tracker.length === 0 ? <p className="mt-3 text-sm text-slate-600">Loading…</p> : null}
          {!loading && tracker.length === 0 ? <p className="mt-3 text-sm text-slate-600">No briefings sent yet.</p> : null}
          <ul className="mt-3 space-y-3">
            {tracker.map((entry) => {
              const counts = (entry.counts || {}) as Record<string, number>;
              return (
                <li key={String(entry.briefingId)} className="rounded-xl border border-slate-200 p-3">
                  <p className="font-semibold text-slate-900">{String(entry.title || entry.briefingId)}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Sent {counts.sent ?? 0} · Opened {counts.openedCount ?? 0} · Read {counts.readCount ?? 0} · Ack{" "}
                    {counts.acknowledgedCount ?? 0} · Signed {counts.signedCount ?? 0} · Replies {counts.replyCount ?? 0} · Overdue{" "}
                    {counts.overdueCount ?? 0}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
