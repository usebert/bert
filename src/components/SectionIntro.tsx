import type { Role } from "../permissions";
import { getRoleTheme } from "../config/roleTheme";

type Props = {
  text: string;
  className?: string;
  /** When set, applies a subtle role-accent left border. */
  role?: Role;
};

export function SectionIntro({ text, className = "", role }: Props) {
  const accentClass = role ? getRoleTheme(role).sectionIntro : "";
  return (
    <p className={["text-sm leading-6", role ? accentClass : "text-slate-600", className].join(" ")}>
      {text}
    </p>
  );
}
