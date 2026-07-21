/** Shared readable text + light-surface classes (BERT brand tokens in index.css / design-tokens.css). */

export const BERT_LIGHT_SURFACE =
  "bert-light-surface bert-ui-surface rounded-[var(--ui-radius-lg)] p-4";

export const BERT_LIGHT_NESTED =
  "bert-light-surface bert-ui-muted-surface rounded-[var(--ui-radius-md)] p-4";

export const BERT_CARD_TITLE = "font-semibold text-[var(--ui-text-primary)]";

export const BERT_CARD_BODY = "text-sm text-[var(--ui-text-secondary)]";

export const BERT_CARD_MUTED = "text-xs text-[var(--ui-text-muted)]";

export const BERT_CARD_META = "text-[11px] font-semibold text-[var(--ui-text-muted)]";

export const BERT_FORM_LABEL = "text-xs font-semibold text-[var(--ui-text-secondary)]";

export const BERT_INPUT =
  "min-h-[var(--ui-control-height)] rounded-[var(--ui-radius-sm)] border border-[var(--ui-border)] bg-[var(--ui-bg-surface)] px-3 text-sm text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-muted)]";

/** Primary title on a light card row (company name, etc.). */
export function bertLightTitle(onDark: boolean): string {
  return onDark ? "text-xl font-bold text-white" : "text-xl font-bold text-slate-950";
}

/** Secondary / helper copy on a light card row. */
export function bertLightMuted(onDark: boolean): string {
  return onDark ? "text-sm leading-relaxed text-slate-300" : "text-sm leading-relaxed text-slate-600";
}

/** Technical / mono details when expanded. */
export function bertLightTechnical(onDark: boolean): string {
  return onDark
    ? "font-mono text-[11px] leading-relaxed text-slate-400"
    : "font-mono text-[11px] leading-relaxed text-slate-600";
}
