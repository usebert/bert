import type { Role } from "../permissions";
import { getRoleTheme } from "../config/roleTheme";
import { darkPanelRoleIntro } from "../styles/darkPanel";

type Props = {
  text: string;
  className?: string;
  /** When set, applies a subtle role-accent left border. */
  role?: Role;
  /** Use on navy/slate-950 hero panels; keeps light cards on the default onLight tone. */
  tone?: "onLight" | "onDark";
};

export function SectionIntro({ text, className = "", role, tone = "onLight" }: Props) {
  const accentClass = role
    ? tone === "onDark"
      ? darkPanelRoleIntro(role)
      : getRoleTheme(role).sectionIntro
    : tone === "onDark"
      ? "text-slate-300"
      : "text-slate-600";
  return (
    <p className={["text-sm leading-6", accentClass, className].join(" ")}>
      {text}
    </p>
  );
}
