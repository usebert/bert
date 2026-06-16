import { FormEvent, useState } from "react";
import { BertLogo } from "../components/BertLogo";
import { confirmPasswordReset } from "../services/passwordResetService";

type PasswordResetConfirmProps = {
  tokenId: string;
  code: string;
  themeMode: "dark" | "light";
  onBackToSignIn: () => void;
};

export function PasswordResetConfirm({ tokenId, code, themeMode, onBackToSignIn }: PasswordResetConfirmProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await confirmPasswordReset({ tokenId, code, password, confirmPassword });
      if (!result.ok) {
        setError(result.error || "Unable to reset password. The link may have expired.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const shellClass = [
    "flex min-h-[100dvh] w-full max-w-[100vw] flex-col items-center justify-center overflow-hidden px-3 py-4 sm:px-4 sm:py-5",
    themeMode === "dark" ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900",
  ].join(" ");

  const cardClass = [
    "relative flex w-full max-w-md flex-col overflow-hidden rounded-[2.2rem] border p-4 backdrop-blur sm:p-5",
    themeMode === "dark"
      ? "border-slate-800/80 bg-slate-950/80 shadow-[0_32px_90px_rgba(2,6,23,0.58)]"
      : "border-slate-200/85 bg-white/90 shadow-[0_28px_80px_rgba(15,23,42,0.14)]",
  ].join(" ");

  return (
    <div className={shellClass}>
      <div className={cardClass}>
        <BertLogo variant="full" tone={themeMode === "dark" ? "onDark" : "onLight"} size="md" className="mx-auto w-full max-w-[220px]" />
        <h1 className="mt-4 text-center text-lg font-semibold">Choose a new password</h1>

        {done ? (
          <div className="mt-4 space-y-4">
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
              Your password has been updated. You can sign in with your email and the new password.
            </p>
            <button
              type="button"
              onClick={onBackToSignIn}
              className="h-11 w-full rounded-xl bg-gradient-to-r from-orange-400 to-orange-600 text-sm font-semibold text-slate-950"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={(event) => void handleSubmit(event)}>
            <div>
              <label className="mb-1 block text-xs font-medium sm:text-sm">New password</label>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                className="h-11 w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/15 sm:h-12 sm:text-base"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium sm:text-sm">Confirm password</label>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                className="h-11 w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/15 sm:h-12 sm:text-base"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
              Show passwords
            </label>
            {error ? (
              <p className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-100 sm:text-sm">{error}</p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-xl bg-gradient-to-r from-orange-400 to-orange-600 text-sm font-semibold text-slate-950 disabled:opacity-60 sm:h-12 sm:text-base"
            >
              {submitting ? "Updating…" : "Update password"}
            </button>
            <button type="button" onClick={onBackToSignIn} className="w-full text-xs font-medium text-blue-400 hover:text-orange-200 sm:text-sm">
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
