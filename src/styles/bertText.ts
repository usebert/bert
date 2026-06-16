/** Shared readable text + light-surface classes (BERT brand tokens in index.css). */

export const BERT_LIGHT_SURFACE =
  "bert-light-surface rounded-3xl border border-slate-200/90 bg-white p-4 shadow-sm";

export const BERT_LIGHT_NESTED =
  "bert-light-surface rounded-2xl border border-slate-200 bg-slate-50 p-4";

export const BERT_CARD_TITLE = "font-semibold text-slate-900";

export const BERT_CARD_BODY = "text-sm text-slate-700";

export const BERT_CARD_MUTED = "text-xs text-slate-600";

export const BERT_CARD_META = "text-[11px] font-semibold text-slate-500";

export const BERT_FORM_LABEL = "text-xs font-semibold text-slate-700";

export const BERT_INPUT =
  "rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400";

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
