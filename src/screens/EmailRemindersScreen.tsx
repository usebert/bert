import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../config/apiBase";
import { parseJsonApiResponse } from "../utils/parseJsonApiResponse";
import { darkPanelDescription, darkPanelEyebrow, darkPanelShellCompact, darkPanelTitleSm } from "../styles/darkPanel";

export type EmailReminderRow = {
  id: string;
  message: string;
  remindAt: number;
  status: "pending" | "sent" | "cancelled";
  createdAt: number;
  sentAt: number | null;
};

type Props = {
  userEmail: string;
  themeMode: "light" | "dark";
  slatePrimaryCtaInteract: string;
  devApiHeaders?: Record<string, string>;
};

function formatWhen(ms: number) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function defaultRemindAtLocal() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EmailRemindersScreen({ userEmail, themeMode, slatePrimaryCtaInteract, devApiHeaders }: Props) {
  const { t } = useTranslation();
  const [reminders, setReminders] = useState<EmailReminderRow[]>([]);
  const [smtpConfigured, setSmtpConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [remindAtLocal, setRemindAtLocal] = useState(defaultRemindAtLocal);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(devApiHeaders || {}),
    }),
    [devApiHeaders],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/reminders"), {
        credentials: "include",
        headers: devApiHeaders || {},
      });
      const data = await parseJsonApiResponse<{
        ok?: boolean;
        reminders?: EmailReminderRow[];
        smtpConfigured?: boolean;
        error?: string;
      }>(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to load reminders.");
      }
      setReminders(data.reminders || []);
      setSmtpConfigured(data.smtpConfigured !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load reminders.");
    } finally {
      setLoading(false);
    }
  }, [devApiHeaders]);

  useEffect(() => {
    void load();
  }, [load, userEmail]);

  const pending = useMemo(() => reminders.filter((r) => r.status === "pending"), [reminders]);
  const sent = useMemo(() => reminders.filter((r) => r.status === "sent"), [reminders]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    setError("");
    try {
      const remindAt = new Date(remindAtLocal).getTime();
      const response = await fetch(apiUrl("/api/reminders"), {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ message: message.trim(), remindAt }),
      });
      const data = await parseJsonApiResponse<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to save reminder.");
      }
      setMessage("");
      setRemindAtLocal(defaultRemindAtLocal());
      setStatus("Reminder scheduled — we will email you when it is due.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save reminder.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    setError("");
    try {
      const response = await fetch(apiUrl(`/api/reminders/${encodeURIComponent(id)}`), {
        method: "DELETE",
        credentials: "include",
        headers: devApiHeaders || {},
      });
      const data = await parseJsonApiResponse<{ ok?: boolean; error?: string }>(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to cancel reminder.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to cancel reminder.");
    }
  };

  return (
    <div className="space-y-4">
      <section className={[darkPanelShellCompact, themeMode === "dark" ? "!bg-slate-900" : ""].join(" ")}>
        <p className={darkPanelEyebrow}>{t("reminders.eyebrow")}</p>
        <h2 className={darkPanelTitleSm}>{t("reminders.title")}</h2>
        <p className={["mt-1", darkPanelDescription].join(" ")}>
          Schedule notes like “phone Ed today” or “insurance due next week”. We email{" "}
          <span className="font-semibold text-white">{userEmail}</span> at the time you choose.
        </p>
      </section>

      {!smtpConfigured ? (
        <section className="rounded-[1.75rem] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          SMTP is not configured on the API host. Reminders cannot be sent until SMTP env vars are set.
        </section>
      ) : null}

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <form className="space-y-3" onSubmit={handleSubmit}>
          <label className="block text-sm font-semibold text-slate-900">
            What should we remind you about?
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={2000}
              required
              placeholder="e.g. Phone Ed about the audit pack"
              className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-900">
            When?
            <input
              type="datetime-local"
              value={remindAtLocal}
              onChange={(e) => setRemindAtLocal(e.target.value)}
              required
              className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {status ? <p className="text-sm text-emerald-700">{status}</p> : null}
          <button
            type="submit"
            disabled={saving || !smtpConfigured}
            className={`h-12 w-full rounded-2xl bg-[#ea580c] text-sm font-semibold text-white disabled:opacity-50 ${slatePrimaryCtaInteract}`}
          >
            {saving ? t("reminders.saving") : t("reminders.scheduleReminder")}
          </button>
        </form>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Upcoming</p>
        {loading ? (
          <p className="mt-2 text-sm text-slate-500">{t("common.loading")}</p>
        ) : pending.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No pending reminders.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {pending.map((row) => (
              <li key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-900">{row.message}</p>
                <p className="mt-1 text-xs text-slate-500">{formatWhen(row.remindAt)}</p>
                <button
                  type="button"
                  onClick={() => void handleCancel(row.id)}
                  className="mt-2 text-xs font-semibold text-slate-600 underline"
                >
                  {t("reminders.cancel")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sent.length > 0 ? (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Sent</p>
          <ul className="mt-3 space-y-2">
            {sent.slice(0, 10).map((row) => (
              <li key={row.id} className="rounded-2xl border border-slate-100 p-3">
                <p className="text-sm text-slate-800">{row.message}</p>
                <p className="mt-1 text-xs text-slate-500">Sent {formatWhen(row.sentAt || row.remindAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
