/**
 * BERT UI Foundation — class helpers and token references for components.
 */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const UI_TOKENS = {
  bgApp: "var(--ui-bg-app)",
  bgSurface: "var(--ui-bg-surface)",
  textPrimary: "var(--ui-text-primary)",
  textSecondary: "var(--ui-text-secondary)",
  textMuted: "var(--ui-text-muted)",
  brand: "var(--ui-brand)",
  accent: "var(--ui-accent)",
  border: "var(--ui-border)",
  borderFocus: "var(--ui-border-focus)",
  radiusSm: "var(--ui-radius-sm)",
  radiusMd: "var(--ui-radius-md)",
  radiusLg: "var(--ui-radius-lg)",
  controlHeight: "var(--ui-control-height)",
  pageMaxWidth: "var(--ui-page-max-width)",
  transition: "var(--ui-transition)",
  zDialog: "var(--ui-z-dialog)",
} as const;

export const controlBase =
  "min-h-[var(--ui-control-height)] w-full rounded-[var(--ui-radius-sm)] border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] px-3 text-sm text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-muted)] transition-[border-color,box-shadow] duration-[var(--ui-transition)] focus-visible:border-[var(--ui-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-border-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-border-focus)] focus-visible:ring-offset-2";
