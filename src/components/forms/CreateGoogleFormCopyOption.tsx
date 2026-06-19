import { TemplateLanguageFields } from "./TemplateLanguageFields";
import type { FormLanguageCode } from "../../config/templateLanguages";
import type { GoogleFormCopyOptionState } from "../../utils/googleFormCopyOptionState";

type CreateGoogleFormCopyOptionProps = {
  optionState: GoogleFormCopyOptionState;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  googleFormCopyLanguage: FormLanguageCode;
  onGoogleFormCopyLanguageChange: (value: FormLanguageCode) => void;
  idPrefix?: string;
};

export function CreateGoogleFormCopyOption({
  optionState,
  checked,
  onCheckedChange,
  googleFormCopyLanguage,
  onGoogleFormCopyLanguageChange,
  idPrefix = "google-form-copy",
}: CreateGoogleFormCopyOptionProps) {
  if (!optionState.visible) {
    return null;
  }

  return (
    <div className="space-y-3">
      {checked ? (
        <TemplateLanguageFields
          language={googleFormCopyLanguage}
          translationStatus={googleFormCopyLanguage === "en" ? "Original" : "Draft translation"}
          onLanguageChange={onGoogleFormCopyLanguageChange}
          showGoogleFormCopyWarning
          disabled={optionState.disabled}
          idPrefix={idPrefix}
        />
      ) : null}
      <label
        className={[
          "flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700",
          optionState.disabled ? "opacity-70" : "",
        ].join(" ")}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={optionState.disabled}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed"
        />
        <span>
          <span className="font-semibold text-slate-900">Create Google Form copy</span>
          <span className="mt-1 block text-xs text-slate-500">{optionState.helperText}</span>
        </span>
      </label>
    </div>
  );
}
