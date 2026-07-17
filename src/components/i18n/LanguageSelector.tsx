import { useTranslation } from "react-i18next";
import type { SupportedLanguage } from "../../i18n/types";

type Props = {
  value: SupportedLanguage;
  onChange: (language: SupportedLanguage) => void;
  className?: string;
  compact?: boolean;
};

export function LanguageSelector({ value, onChange, className = "", compact = false }: Props) {
  const { t } = useTranslation();

  if (compact) {
    return (
      <label className={`inline-flex items-center gap-2 text-xs text-slate-200 ${className}`.trim()}>
        <span className="sr-only">{t("language.label")}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as SupportedLanguage)}
          className="rounded-lg border border-white/20 bg-slate-950/50 px-2 py-1 text-xs font-semibold text-white outline-none focus:border-orange-400"
          aria-label={t("language.label")}
        >
          <option value="en">{t("language.english")}</option>
          <option value="it">{t("language.italian")}</option>
        </select>
      </label>
    );
  }

  return (
    <section className={`rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm ${className}`.trim()}>
      <p className="text-sm font-semibold text-slate-900">{t("language.label")}</p>
      <p className="mt-1 text-sm text-slate-500">{t("language.description")}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {([
          { id: "en" as const, titleKey: "language.english" as const },
          { id: "it" as const, titleKey: "language.italian" as const },
        ]).map((option) => {
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={[
                "rounded-[1.5rem] border px-4 py-4 text-left transition",
                selected
                  ? "border-slate-900 bg-slate-900 text-white shadow-[0_16px_28px_rgba(15,23,42,0.18)]"
                  : "border-slate-200 bg-slate-50 text-slate-700",
              ].join(" ")}
            >
              <p className="text-sm font-semibold">{t(option.titleKey)}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
