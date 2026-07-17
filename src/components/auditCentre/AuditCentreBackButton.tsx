import { useTranslation } from "react-i18next";
import { bertSecondaryButtonInteract } from "../../styles/interactions";

type Props = {
  onClick: () => void;
  variant?: "light" | "dark";
  className?: string;
};

export function AuditCentreBackButton({ onClick, variant = "light", className = "" }: Props) {
  const { t } = useTranslation();
  const toneClass =
    variant === "dark"
      ? "border-white/25 bg-white/10 text-white hover:bg-white/15"
      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex min-h-[44px] items-center rounded-xl border px-4 text-sm font-semibold",
        toneClass,
        bertSecondaryButtonInteract,
        className,
      ].join(" ")}
    >
      {t("audits.backToCentre")}
    </button>
  );
}
