import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../../config/apiBase";
import type { CompanyOnboardingInviteResult, CompanyOnboardingInviteRow } from "../../types/adminScreenProps";
import { SectionHeader } from "../dashboard/DashboardPrimitives";

const pilotLightSurface = "rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm";
const pilotLightNested = "rounded-xl border border-slate-200/80 bg-slate-50/80 p-4";
const pilotEditableInput =
  "mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-200/40 disabled:cursor-not-allowed disabled:bg-slate-100";

type Props = {
  googleWorkspaceReady: boolean;
  sending: boolean;
  onSend: (input: {
    contactEmail: string;
    contactName: string;
    provisionalCompanyName: string;
    notes: string;
  }) => Promise<CompanyOnboardingInviteResult | null>;
  lastResult: CompanyOnboardingInviteResult | null;
  onDismissResult: () => void;
  parseJsonApiResponse: <T = Record<string, unknown>>(response: Response) => Promise<T>;
};

function statusTone(status: string) {
  const key = status.toLowerCase();
  if (key === "live") return "bg-emerald-100 text-emerald-800";
  if (key === "failed" || key === "setup_failed") return "bg-rose-100 text-rose-800";
  if (key === "submitted" || key === "started") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

export function CompanyOnboardingInvitePanel({
  googleWorkspaceReady,
  sending,
  onSend,
  lastResult,
  onDismissResult,
  parseJsonApiResponse,
}: Props) {
  const [contactEmail, setContactEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [provisionalCompanyName, setProvisionalCompanyName] = useState("");
  const [notes, setNotes] = useState("");
  const [invites, setInvites] = useState<CompanyOnboardingInviteRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  const refreshInvites = useCallback(async () => {
    setLoadingList(true);
    try {
      const response = await fetch(apiUrl("/api/onboarding/company-onboarding/invites"), {
        credentials: "include",
      });
      const payload = (await parseJsonApiResponse(response)) as {
        ok?: boolean;
        invites?: CompanyOnboardingInviteRow[];
      };
      if (response.ok && payload.ok && Array.isArray(payload.invites)) {
        setInvites(payload.invites);
      }
    } catch {
      /* list is best-effort */
    } finally {
      setLoadingList(false);
    }
  }, [parseJsonApiResponse]);

  useEffect(() => {
    if (googleWorkspaceReady) {
      void refreshInvites();
    }
  }, [googleWorkspaceReady, refreshInvites, lastResult]);

  const handleSend = async () => {
    const result = await onSend({
      contactEmail: contactEmail.trim().toLowerCase(),
      contactName: contactName.trim(),
      provisionalCompanyName: provisionalCompanyName.trim(),
      notes: notes.trim(),
    });
    if (result?.ok) {
      setContactEmail("");
      setContactName("");
      setProvisionalCompanyName("");
      setNotes("");
      void refreshInvites();
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  };

  const resendInvite = async (inviteId: string) => {
    const response = await fetch(apiUrl(`/api/onboarding/company-onboarding/invites/${encodeURIComponent(inviteId)}/resend`), {
      method: "POST",
      credentials: "include",
    });
    const payload = (await parseJsonApiResponse(response)) as CompanyOnboardingInviteResult;
    if (payload.inviteUrl) {
      await copyLink(payload.inviteUrl);
    }
    void refreshInvites();
  };

  const revokeInvite = async (inviteId: string) => {
    await fetch(apiUrl(`/api/onboarding/company-onboarding/invites/${encodeURIComponent(inviteId)}`), {
      method: "DELETE",
      credentials: "include",
    });
    void refreshInvites();
  };

  const retryProvision = async (inviteId: string) => {
    const response = await fetch(apiUrl(`/api/onboarding/company-onboarding/invites/${encodeURIComponent(inviteId)}/retry`), {
      method: "POST",
      credentials: "include",
    });
    await parseJsonApiResponse(response);
    void refreshInvites();
  };

  const repairInvite = async (inviteId: string) => {
    const response = await fetch(apiUrl(`/api/onboarding/company-onboarding/invites/${encodeURIComponent(inviteId)}/repair`), {
      method: "POST",
      credentials: "include",
    });
    await parseJsonApiResponse(response);
    void refreshInvites();
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());

  return (
    <section className={pilotLightSurface}>
      <SectionHeader
        icon="spark"
        eyebrow="Godmode"
        title="Company Onboarding"
        subtitle="Send a single-use onboarding link. The customer completes company details and creates the first admin. BERT provisions Drive, the company master sheet, folders, and the first admin."
      />
      <div className={pilotLightNested}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-sm font-semibold text-slate-900">Contact email</span>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              disabled={!googleWorkspaceReady}
              className={pilotEditableInput}
              placeholder="admin@example.com"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-900">Contact name (optional)</span>
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              disabled={!googleWorkspaceReady}
              className={pilotEditableInput}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-900">Provisional company name (optional)</span>
            <input
              value={provisionalCompanyName}
              onChange={(e) => setProvisionalCompanyName(e.target.value)}
              disabled={!googleWorkspaceReady}
              className={pilotEditableInput}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-semibold text-slate-900">Notes (internal)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!googleWorkspaceReady}
              rows={2}
              className={pilotEditableInput}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={!googleWorkspaceReady || !emailValid || sending}
          onClick={() => void handleSend()}
          className="mt-3 h-11 w-full rounded-2xl bg-orange-500 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send company onboarding invite"}
        </button>

        {lastResult ? (
          <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50/80 p-4 text-sm text-slate-800">
            <p className="font-semibold text-slate-900">
              {lastResult.sent ? "Invite email sent" : "Copy the onboarding link"}
            </p>
            {lastResult.inviteUrl ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-xs font-semibold"
                  onClick={() => void copyLink(lastResult.inviteUrl || "")}
                >
                  Copy link
                </button>
                {lastResult.mailtoUrl ? (
                  <a
                    href={lastResult.mailtoUrl}
                    className="rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-xs font-semibold"
                  >
                    Open mail draft
                  </a>
                ) : null}
              </div>
            ) : null}
            <button type="button" className="mt-3 text-xs font-semibold text-orange-800 underline" onClick={onDismissResult}>
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="mt-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">Onboarding invites</p>
            <button
              type="button"
              className="text-xs font-semibold text-orange-700"
              onClick={() => void refreshInvites()}
              disabled={loadingList}
            >
              {loadingList ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {invites.length === 0 ? (
            <p className="mt-2 text-xs text-slate-600">No invites yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {invites.map((invite) => (
                <li key={invite.inviteId} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{invite.provisionalCompanyName || invite.contactEmail}</p>
                      <p className="text-xs text-slate-600">{invite.contactEmail}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(invite.status)}`}>
                      {invite.statusLabel || invite.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {invite.status !== "live" ? (
                      <>
                        <button
                          type="button"
                          className="text-xs font-semibold text-orange-700"
                          onClick={() => void resendInvite(invite.inviteId)}
                        >
                          Resend
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-slate-600"
                          onClick={() => void revokeInvite(invite.inviteId)}
                        >
                          Revoke
                        </button>
                      </>
                    ) : null}
                    {invite.canRetrySetup || invite.status === "setup_failed" || invite.status === "failed" ? (
                      <>
                        <button
                          type="button"
                          className="text-xs font-semibold text-amber-800"
                          onClick={() => void retryProvision(invite.inviteId)}
                        >
                          Retry setup
                        </button>
                        {invite.companyFolderId ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-slate-700"
                            onClick={() => void repairInvite(invite.inviteId)}
                          >
                            Repair
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    {invite.companyFolderUrl ? (
                      <a
                        href={invite.companyFolderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-slate-700 underline"
                      >
                        Open folder
                      </a>
                    ) : null}
                    {invite.masterSheetUrl ? (
                      <a
                        href={invite.masterSheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-slate-700 underline"
                      >
                        Open sheet
                      </a>
                    ) : null}
                  </div>
                  {invite.provisionError ? (
                    <div className="mt-2 text-xs text-rose-700">
                      {invite.provisionStage ? (
                        <p className="font-semibold text-rose-800">Failed at: {invite.provisionStage}</p>
                      ) : null}
                      <p>{invite.provisionError}</p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
