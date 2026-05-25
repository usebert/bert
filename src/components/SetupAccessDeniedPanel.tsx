import { slatePrimaryCtaInteract } from "../styles/interactions";

type Props = {
  onGoToDashboard: () => void;
  slatePrimaryCtaInteract?: string;
};

/** Shown when a non-Master user opens /setup or /setup/initial directly. */
export function SetupAccessDeniedPanel({
  onGoToDashboard,
  slatePrimaryCtaInteract: ctaClass = slatePrimaryCtaInteract,
}: Props) {
  return (
    <section className="mx-auto max-w-lg rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Not authorized</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Setup is not available</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Platform setup is only available to the BERT platform owner. Use your usual Dashboard, Workspace, or field
        menus for day-to-day work.
      </p>
      <button
        type="button"
        onClick={onGoToDashboard}
        className={`mt-5 h-11 w-full rounded-2xl bg-[#ea580c] text-sm font-semibold text-white sm:w-auto sm:px-6 ${ctaClass}`}
      >
        Go to Dashboard
      </button>
    </section>
  );
}
