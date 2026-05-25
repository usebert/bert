import { canCompleteAuditAsAuditor, getRoleDisplayName } from "../permissions";
import { getRoleTheme } from "../config/roleTheme";
import type { AccountSettingsScreenProps } from "../types/accountScreenProps";
import { darkPanelDescription, darkPanelEyebrow, darkPanelShellCompact, darkPanelTitleSm } from "../styles/darkPanel";

export function AccountSettingsScreen({
  currentUser,
  accountNameInput,
  accountPhotoUrl,
  themeMode,
  companyName,
  slatePrimaryCtaInteract,
  onAccountNameChange,
  onAccountPhotoChange,
  onThemeModeChange,
  onSave,
  workspaceSetupLimitedShell,
  onOpenFullAppNavigation,
}: AccountSettingsScreenProps) {
  const godMode = currentUser.role === "Master";
  const fieldAuditor = canCompleteAuditAsAuditor(currentUser.role);
  const theme = getRoleTheme(currentUser.role);

  return (
    <div className="space-y-4">
      <section
        className={[
          fieldAuditor
            ? "rounded-2xl border border-violet-200/80 bg-violet-50/60 px-5 py-4 text-slate-900 shadow-sm"
            : [darkPanelShellCompact, themeMode === "dark" ? "!bg-slate-900" : ""].join(" "),
        ].join(" ")}
      >
        <p className={fieldAuditor ? "text-xs font-semibold uppercase tracking-[0.3em] text-violet-700" : darkPanelEyebrow}>
          Account
        </p>
        <h2 className={fieldAuditor ? "mt-1 text-xl font-semibold tracking-tight text-slate-900" : darkPanelTitleSm}>
          {godMode ? "Device settings" : fieldAuditor ? "Your profile" : "Manage your profile"}
        </h2>
        <p className={["mt-1", fieldAuditor ? "text-sm leading-5 text-slate-600" : darkPanelDescription].join(" ")}>
          {godMode
            ? "Control the appearance and device-level settings used for platform setup."
            : fieldAuditor
              ? `Update how you appear on this tablet at ${companyName}.`
              : "Update your display name, profile photo, and appearance for this device."}
        </p>
      </section>

      {workspaceSetupLimitedShell && onOpenFullAppNavigation ? (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Workspace setup</p>
          <p className="mt-1 text-sm text-slate-500">
            You are in setup-only mode (onboarding only). Open the full app when you need the rest of BERT on this device.
          </p>
          <button
            type="button"
            onClick={onOpenFullAppNavigation}
            className={`mt-4 h-12 w-full rounded-2xl border border-slate-300 bg-slate-50 text-sm font-semibold text-slate-900 ${slatePrimaryCtaInteract}`}
          >
            Open full BERT navigation
          </button>
        </section>
      ) : null}

      {!godMode && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl bg-slate-100">
              {accountPhotoUrl ? (
                <img src={accountPhotoUrl} alt={accountNameInput || currentUser.name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-semibold text-slate-500">
                  {(accountNameInput || currentUser.name).slice(0, 1)}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{accountNameInput || currentUser.name}</p>
              <p className="text-xs text-slate-500">{getRoleDisplayName(currentUser.role)}</p>
              <label
                className={[
                  "mt-3 inline-flex min-h-[2.75rem] cursor-pointer items-center rounded-xl px-5 text-sm font-semibold text-white",
                  fieldAuditor ? theme.primaryButton : "bg-slate-900",
                  slatePrimaryCtaInteract,
                ].join(" ")}
              >
                Upload photo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onAccountPhotoChange(file);
                      event.target.value = "";
                    }
                  }}
                />
              </label>
            </div>
          </div>
        </section>
      )}

      {!fieldAuditor && (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Appearance</p>
          <p className="mt-1 text-sm text-slate-500">Choose how {companyName} looks on this tablet.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {(["light", "dark"] as const).map((mode) => {
              const selected = themeMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => onThemeModeChange(mode)}
                  className={[
                    "rounded-[1.5rem] border px-4 py-4 text-left transition",
                    selected
                      ? `border-slate-900 bg-slate-900 text-white shadow-[0_16px_28px_rgba(15,23,42,0.18)] ${slatePrimaryCtaInteract}`
                      : "border-slate-200 bg-slate-50 text-slate-700",
                  ].join(" ")}
                >
                  <p className="text-sm font-semibold">{mode === "light" ? "Light mode" : "Dark mode"}</p>
                  <p className={["mt-1 text-xs leading-5", selected ? "text-slate-300" : "text-slate-500"].join(" ")}>
                    {mode === "light" ? "Bright interface for daylight and clean demos." : "Lower-glare interface for darker settings and a sharper look."}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {!godMode && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">Display name</label>
          <input
            value={accountNameInput}
            onChange={(event) => onAccountNameChange(event.target.value)}
            className="min-h-[3rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
            placeholder="Enter your name"
          />
          <button
            onClick={onSave}
            className={[
              "mt-4 min-h-[3rem] w-full rounded-2xl text-sm font-semibold text-white",
              fieldAuditor ? theme.primaryButton : "bg-slate-900",
              slatePrimaryCtaInteract,
            ].join(" ")}
          >
            Save
          </button>
        </section>
      )}
    </div>
  );
}
