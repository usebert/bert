type Props = {
  title?: string;
  steps: string[];
  className?: string;
};

export function WhatHappensNextPanel({ title = "What happens next?", steps, className = "" }: Props) {
  if (steps.length === 0) {
    return null;
  }
  return (
    <section className={["rounded-2xl border border-sky-100 bg-sky-50/80 px-4 py-3", className].join(" ")}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-800">{title}</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-sky-950">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
