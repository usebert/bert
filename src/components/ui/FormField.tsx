import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn, controlBase } from "../../styles/ui-foundation";

export type FormFieldProps = {
  id: string;
  label: string;
  children: ReactNode;
  helperText?: string;
  error?: string;
  required?: boolean;
  className?: string;
};

export function FormField({ id, label, children, helperText, error, required, className }: FormFieldProps) {
  const describedBy = [error ? `${id}-error` : "", helperText ? `${id}-helper` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-xs font-semibold text-[var(--ui-text-secondary)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--ui-danger-fg)]">*</span> : null}
      </label>
      <div aria-describedby={describedBy}>{children}</div>
      {helperText && !error ? (
        <p id={`${id}-helper`} className="text-xs text-[var(--ui-text-muted)]">
          {helperText}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-[var(--ui-danger-fg)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(controlBase, "min-h-[6rem] resize-y py-2.5", className)}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(controlBase, "pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({
  className,
  label,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label htmlFor={id} className="inline-flex min-h-[var(--ui-control-height)] cursor-pointer items-center gap-2 text-sm text-[var(--ui-text-primary)]">
      <input
        id={id}
        type="checkbox"
        className={cn("h-5 w-5 rounded border-[var(--ui-border)] text-[var(--ui-accent)] focus-visible:ring-2 focus-visible:ring-[var(--ui-border-focus)]", className)}
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
}

export function Radio({
  className,
  label,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label htmlFor={id} className="inline-flex min-h-[var(--ui-control-height)] cursor-pointer items-center gap-2 text-sm text-[var(--ui-text-primary)]">
      <input
        id={id}
        type="radio"
        className={cn("h-5 w-5 border-[var(--ui-border)] text-[var(--ui-accent)] focus-visible:ring-2 focus-visible:ring-[var(--ui-border-focus)]", className)}
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  id: string;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="inline-flex min-h-[var(--ui-control-height)] cursor-pointer items-center gap-3 text-sm text-[var(--ui-text-primary)]">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-7 w-12 rounded-full border transition-colors duration-[var(--ui-transition)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-border-focus)] focus-visible:ring-offset-2",
          checked ? "border-[var(--ui-accent)] bg-[var(--ui-accent)]" : "border-[var(--ui-border)] bg-[var(--ui-bg-muted)]",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-[var(--ui-transition)]",
            checked && "translate-x-5",
          )}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}

export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--ui-text-muted)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <Input className={cn("pl-9", className)} type="search" {...rest} />
    </div>
  );
}

export function FileInput({
  id,
  label,
  onFileChange,
  accept,
  disabled,
}: {
  id: string;
  label: string;
  onFileChange: (file: File | null) => void;
  accept?: string;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex min-h-[var(--ui-control-height)] cursor-pointer items-center rounded-[var(--ui-radius-sm)] border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 text-sm font-semibold text-[var(--ui-text-primary)] transition-colors hover:bg-[var(--ui-bg-surface)]",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      {label}
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => onFileChange(event.target.files?.[0] || null)}
      />
    </label>
  );
}
