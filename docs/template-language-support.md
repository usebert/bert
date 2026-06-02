# BERT template language support

## Scope

- **In scope:** Form/check template content language (BERT builder, `AuditTemplates` sheet, Google Form copies, offline tablet cache metadata).
- **Out of scope:** App UI locale / i18n (unless added later).

English (`en`) remains the default. There is **no automatic translation** in this release; optional `AuditTemplateTranslations` rows are filled manually or by a future approved service (draft-only).

## Supported languages

| Code | Language   |
|------|------------|
| en   | English    |
| cy   | Welsh      |
| pl   | Polish     |
| ro   | Romanian   |
| es   | Spanish    |
| fr   | French     |
| pt   | Portuguese |

## Company setting

Config tab key: `defaultFormLanguage` (see `CONFIG_KEY_DEFAULT_FORM_LANGUAGE`).

Returned with company areas API and used as the default in the template builder.

## Sheet schema

### AuditTemplates (extended)

- `Language` — active template content language
- `Default Language` — company/original baseline (usually `en`)
- `Translation Status` — `Original` | `Draft translation` | `Needs review` | `Approved` | `Outdated`

### AuditTemplateTranslations (optional)

Per-language content for a BERT template ID. Used when creating Google Form copies and for future builder translation tabs. Columns match `AUDIT_TEMPLATE_TRANSLATIONS_COLUMNS` in `server/template-languages.mjs`.

### GoogleFormTemplates (extended)

- `Language`, `Locale`, `Translation Source`, `Translation Status`

## Runtime behaviour

1. Builder selects language (defaults to company `defaultFormLanguage`).
2. Save persists language fields on `AuditTemplates` and in local `AuditTemplate` state.
3. Google Form create uses `resolveTemplateFormCopyContent()` — translation row if present, else English with sync status `Created using fallback language`.
4. Tablet offline cache stores `defaultFormLanguage` and per-template `language` on assigned work.
5. Reports: language on stored results is preserved; report rendering language is unchanged.

## Warnings

- Non-English templates: compliance review warning in builder.
- Google Form copy when status ≠ `Approved`: additional warning before use.

## Files

| Area | Path |
|------|------|
| Client constants | `src/config/templateLanguages.ts` |
| Server resolution | `server/template-languages.mjs` |
| UI | `src/components/forms/TemplateLanguageFields.tsx` |
| Verify | `scripts/verify-template-languages.mjs` |
