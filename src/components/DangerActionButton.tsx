import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

/** Visually distinct control for irreversible or high-impact actions. */
export function DangerActionButton({ children, className = "", type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={[
        "inline-flex items-center justify-center rounded-2xl border-2 border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-900 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
