import { canCompleteAuditAsAuditor } from "../permissions";
import { getRoleTheme } from "../config/roleTheme";
import { AccountIdentitySummary } from "../components/AccountIdentitySummary";
import { LanguageSelector } from "../components/i18n/LanguageSelector";
import type { AccountSettingsScreenProps } from "../types/accountScreenProps";
import { darkPanelDescription, darkPanelEyebrow, darkPanelShellCompact, darkPanelTitleSm } from "../styles/darkPanel";
import { useTranslation } from "react-i18next";

export function AccountSettingsScreen({
  currentUser,
  accountNameInput,
  accountPhotoUrl,
  themeMode,
  uiLanguage,
  companyName,
  actingCompanyName,
  slatePrimaryCtaInteract,
  onAccountNameChange,
  onAccountPhotoChange,
  onThemeModeChange,
  onUiLanguageChange,
  onSave,
  workspaceSetupLimitedShell,
  onOpenFullAppNavigation,
  onOpenUiFoundation,
}: AccountSettingsScreenProps) {
  const { t } = useTranslation();
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
          {t("account.section")}
        </p>
        <h2 className={fieldAuditor ? "mt-1 text-xl font-semibold tracking-tight text-slate-900" : darkPanelTitleSm}>
          {godMode ? t("account.deviceSettings") : fieldAuditor ? t("account.yourProfile") : t("account.manageProfile")}
        </h2>
        <p className={["mt-1", fieldAuditor ? "text-sm leading-5 text-slate-600" : darkPanelDescription].join(" ")}>
          {godMode
            ? t("account.deviceSettingsBody")
            : fieldAuditor
              ? t("account.profileBodyTablet", { companyName })
              : t("account.profileBody")}
        </p>
      </section>

      {workspaceSetupLimitedShell && onOpenFullAppNavigation ? (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">{t("account.workspaceSetup")}</p>
          <p className="mt-1 text-sm text-slate-500">{t("account.workspaceSetupBody")}</p>
          <button
            type="button"
            onClick={onOpenFullAppNavigation}
            className={`mt-4 h-12 w-full rounded-2xl border border-slate-300 bg-slate-50 text-sm font-semibold text-slate-900 ${slatePrimaryCtaInteract}`}
          >
            {t("account.openFullNav")}
          </button>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("account.signedInAs")}</p>
        <div className="mt-3">
          <AccountIdentitySummary
            name={accountNameInput || currentUser.name}
            username={currentUser.username}
            email={currentUser.email}
            role={currentUser.role}
            companyName={companyName}
            actingCompanyName={actingCompanyName}
          />
        </div>
      </section>

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
              <label
                className={[
                  "mt-3 inline-flex min-h-[2.75rem] cursor-pointer items-center rounded-xl px-5 text-sm font-semibold text-white",
                  theme.primaryButton,
                  theme.primaryButtonHover,
                  slatePrimaryCtaInteract,
                ].join(" ")}
              >
                {t("account.uploadPhoto")}
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
          <p className="text-sm font-semibold text-slate-900">{t("account.appearance")}</p>
          <p className="mt-1 text-sm text-slate-500">{t("account.appearanceHint", { companyName })}</p>
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
                  <p className="text-sm font-semibold">{mode === "light" ? t("account.lightMode") : t("account.darkMode")}</p>
                  <p className={["mt-1 text-xs leading-5", selected ? "text-slate-300" : "text-slate-500"].join(" ")}>
                    {mode === "light" ? t("account.lightModeHint") : t("account.darkModeHint")}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <LanguageSelector value={uiLanguage} onChange={onUiLanguageChange} />

      {onOpenUiFoundation ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Developer tools</p>
          <p className="mt-1 text-sm text-slate-600">Preview shared UI foundation components (not shown in production).</p>
          <button
            type="button"
            onClick={onOpenUiFoundation}
            className={`mt-3 h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 ${slatePrimaryCtaInteract}`}
          >
            Open UI foundation showcase
          </button>
        </section>
      ) : null}

      {!godMode && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">{t("account.displayName")}</label>
          <input
            value={accountNameInput}
            onChange={(event) => onAccountNameChange(event.target.value)}
            className="min-h-[3rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white"
            placeholder={t("account.displayNamePlaceholder")}
          />
          <button
            onClick={onSave}
            className={[
              "mt-4 min-h-[3rem] w-full rounded-2xl text-sm font-semibold text-white",
              theme.primaryButton,
              theme.primaryButtonHover,
              slatePrimaryCtaInteract,
            ].join(" ")}
          >
            {t("common.saved")}
          </button>
        </section>
      )}
    </div>
  );
}
