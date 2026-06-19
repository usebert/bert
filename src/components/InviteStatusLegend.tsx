import { INVITE_STATUS_LEGEND, formatInviteStatusLabel, inviteStatusDotClass } from "../utils/inviteStatusDisplay";

export function InviteStatusLegend({ className = "" }: { className?: string }) {
  return (
    <section className={["rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm", className].join(" ")}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">User status explained</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {INVITE_STATUS_LEGEND.map((item) => (
          <li key={item.status} className="flex items-start gap-2 text-sm text-slate-700">
            <span
              className={["mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", inviteStatusDotClass(item.status)].join(" ")}
              aria-hidden
            />
            <span>
              <span className="font-semibold text-slate-900">{formatInviteStatusLabel(item.status)}</span>
              <span className="text-slate-500"> — {item.description}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
