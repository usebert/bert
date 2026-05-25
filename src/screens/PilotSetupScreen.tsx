import { useEffect, useState } from "react";
import { SECTION_INTROS } from "../config/sectionIntros";
import { fetchSetupStatus } from "../services/setupStatusService";
import { SectionIntro } from "../components/SectionIntro";
import { darkPanelBody, darkPanelEyebrow, darkPanelShellCompact, darkPanelTitleSm } from "../styles/darkPanel";
import { slatePrimaryCtaInteract } from "../styles/interactions";

type Props = {
  onOpenInitialSetup: () => void;
  slatePrimaryCtaInteract?: string;
};

/** Master-only platform setup hub (see canAccessPilotSetup). */
export function PilotSetupScreen({
  onOpenInitialSetup,
  slatePrimaryCtaInteract: ctaClass = slatePrimaryCtaInteract,
}: Props) {
  const [readyForPilot, setReadyForPilot] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const setup = await fetchSetupStatus();
      if (!cancelled) {
        setReadyForPilot(setup?.readyForPilot === true ? true : setup?.readyForPilot === false ? false : null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <section className={darkPanelShellCompact}>
        <p className={darkPanelEyebrow}>Platform Setup</p>
        <h2 className={darkPanelTitleSm}>Platform Setup</h2>
        <SectionIntro text={SECTION_INTROS.platformSetup} className="mt-2" tone="onDark" />
        <p className={["mt-2", darkPanelBody].join(" ")}>
          {readyForPilot === true
            ? "Initial setup is complete. Use Companies, Users, and Invites for day-to-day pilot work."
            : "Finish initial setup before inviting companies and users."}
        </p>
      </section>

      <section className="rounded-[1.75rem] border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Initial Setup</p>
        <p className="mt-1 text-sm text-slate-600">
          Configure Google Workspace, shared drive, session storage, invite email, and pilot readiness.
        </p>
        <button
          type="button"
          onClick={onOpenInitialSetup}
          className={`mt-4 h-12 w-full rounded-2xl bg-[#ea580c] text-sm font-semibold text-white sm:w-auto sm:px-6 ${ctaClass}`}
        >
          Open Initial Setup
        </button>
      </section>
    </div>
  );
}
