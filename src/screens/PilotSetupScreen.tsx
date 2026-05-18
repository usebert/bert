import { slatePrimaryCtaInteract } from "../styles/interactions";

type Props = {
  showInitialSetupEntry: boolean;
  onOpenInitialSetup: () => void;
  readyForPilot: boolean | null;
  slatePrimaryCtaInteract?: string;
};

export function PilotSetupScreen({
  showInitialSetupEntry,
  onOpenInitialSetup,
  readyForPilot,
  slatePrimaryCtaInteract: ctaClass = slatePrimaryCtaInteract,
}: Props) {
  return (
    <div className="space-y-4">
      <section className="rounded-[1.75rem] bg-slate-950 px-5 py-4 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)]">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Setup</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Platform setup</h2>
        <p className="mt-1 text-sm leading-5 text-slate-300">
          {readyForPilot === true
            ? "Initial setup is complete. Use Companies, Users, and Invites for day-to-day pilot work."
            : "Finish initial setup before inviting companies and users."}
        </p>
      </section>

      {showInitialSetupEntry ? (
        <section className="rounded-[1.75rem] border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Initial Setup</p>
          <p className="mt-1 text-sm text-slate-600">
            Configure Google Workspace, first operator, shared drive, and pilot readiness.
          </p>
          <button
            type="button"
            onClick={onOpenInitialSetup}
            className={`mt-4 h-12 w-full rounded-2xl bg-[#ea580c] text-sm font-semibold text-white sm:w-auto sm:px-6 ${ctaClass}`}
          >
            Open Initial Setup
          </button>
        </section>
      ) : null}

      {!showInitialSetupEntry ? (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          Initial Setup is managed by the platform owner account. Use Companies, Users, and Invites for your
          workspace.
        </section>
      ) : null}
    </div>
  );
}
