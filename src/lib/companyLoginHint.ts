const STORAGE_KEY = "bert_company_login_hint_v1";

export type CompanyLoginHint = {
  email: string;
  masterSheetId: string;
  companyFolderId?: string;
  companyName?: string;
  savedAt: number;
};

export function readCompanyLoginHint(): CompanyLoginHint | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CompanyLoginHint;
    if (!parsed?.email || !parsed?.masterSheetId) {
      return null;
    }
    return {
      email: String(parsed.email).trim().toLowerCase(),
      masterSheetId: String(parsed.masterSheetId).trim(),
      companyFolderId: parsed.companyFolderId ? String(parsed.companyFolderId).trim() : undefined,
      companyName: parsed.companyName ? String(parsed.companyName).trim() : undefined,
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function saveCompanyLoginHint(hint: Omit<CompanyLoginHint, "savedAt">): void {
  const payload: CompanyLoginHint = {
    email: String(hint.email).trim().toLowerCase(),
    masterSheetId: String(hint.masterSheetId).trim(),
    companyFolderId: hint.companyFolderId ? String(hint.companyFolderId).trim() : undefined,
    companyName: hint.companyName ? String(hint.companyName).trim() : undefined,
    savedAt: Date.now(),
  };
  if (!payload.email || !payload.masterSheetId) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearCompanyLoginHintForEmail(email: string): void {
  const hint = readCompanyLoginHint();
  if (!hint) {
    return;
  }
  if (hint.email === String(email).trim().toLowerCase()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
