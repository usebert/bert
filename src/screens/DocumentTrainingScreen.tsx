import { FormEvent, useCallback, useMemo, useRef, useState } from "react";
import type { DocumentDistribution, ExternalEmployee } from "../types/documentTraining";
import type { DocumentTrainingScreenProps } from "../types/documentTrainingScreenProps";

type TabId = "send" | "tracking" | "employees";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

export function DocumentTrainingScreen({
  workspaceId,
  currentUserName,
  sites,
  onboardedRecipients,
  externalEmployees,
  distributions,
  onSaveExternalEmployees,
  onSendDistribution,
  onRefreshFromServer,
}: DocumentTrainingScreenProps) {
  const [tab, setTab] = useState<TabId>("send");
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [pdfBase64, setPdfBase64] = useState("");
  const [selectedOnboarded, setSelectedOnboarded] = useState<Record<string, boolean>>({});
  const [selectedExternal, setSelectedExternal] = useState<Record<string, boolean>>({});
  const [siteFilter, setSiteFilter] = useState("All");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [trackingSearch, setTrackingSearch] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [employeeDraft, setEmployeeDraft] = useState({
    name: "",
    email: "",
    department: "",
    siteId: "",
  });

  const activeExternal = useMemo(() => externalEmployees.filter((row) => row.active), [externalEmployees]);

  const departments = useMemo(() => {
    const values = new Set<string>();
    onboardedRecipients.forEach((row) => {
      if (row.department) values.add(row.department);
    });
    activeExternal.forEach((row) => {
      if (row.department) values.add(row.department);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [onboardedRecipients, activeExternal]);

  const filteredOnboarded = useMemo(() => {
    return onboardedRecipients.filter((row) => {
      if (siteFilter !== "All" && !row.siteIds.includes(siteFilter)) return false;
      if (departmentFilter !== "All" && row.department !== departmentFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!row.name.toLowerCase().includes(q) && !row.email.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [onboardedRecipients, siteFilter, departmentFilter, search]);

  const filteredExternal = useMemo(() => {
    return activeExternal.filter((row) => {
      if (siteFilter !== "All" && row.siteId && row.siteId !== siteFilter) return false;
      if (departmentFilter !== "All" && row.department !== departmentFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!row.name.toLowerCase().includes(q) && !row.email.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [activeExternal, siteFilter, departmentFilter, search]);

  const selectedRecipientCount = useMemo(() => {
    const onboardedCount = Object.entries(selectedOnboarded).filter(([, on]) => on).length;
    const externalCount = Object.entries(selectedExternal).filter(([, on]) => on).length;
    return onboardedCount + externalCount;
  }, [selectedOnboarded, selectedExternal]);

  const priorityDistributions = useMemo(() => {
    return distributions.filter((item) => item.recipients.some((recipient) => !recipient.acknowledgedAt));
  }, [distributions]);

  const filteredTracking = useMemo(() => {
    const q = trackingSearch.trim().toLowerCase();
    if (!q) return distributions;
    return distributions.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.fileName.toLowerCase().includes(q) ||
        item.recipients.some((recipient) => recipient.email.toLowerCase().includes(q) || recipient.name.toLowerCase().includes(q)),
    );
  }, [distributions, trackingSearch]);

  const handlePdfFile = useCallback(async (file: File | null) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setErrorMessage("Please choose a PDF file.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setErrorMessage("PDF must be 15 MB or smaller.");
      return;
    }
    try {
      const base64 = await readFileAsBase64(file);
      setPdfBase64(base64);
      setFileName(file.name);
      setErrorMessage("");
    } catch {
      setErrorMessage("Unable to read the PDF file.");
    }
  }, []);

  const toggleAllOnboarded = (checked: boolean) => {
    const next: Record<string, boolean> = { ...selectedOnboarded };
    filteredOnboarded.forEach((row) => {
      next[row.id] = checked;
    });
    setSelectedOnboarded(next);
  };

  const toggleAllExternal = (checked: boolean) => {
    const next: Record<string, boolean> = { ...selectedExternal };
    filteredExternal.forEach((row) => {
      next[row.id] = checked;
    });
    setSelectedExternal(next);
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    setStatusMessage("");
    setErrorMessage("");
    if (!workspaceId) {
      setErrorMessage("Link a company workspace before sending documents.");
      return;
    }
    if (!title.trim()) {
      setErrorMessage("Enter a document name.");
      return;
    }
    if (!pdfBase64) {
      setErrorMessage("Add a PDF document.");
      return;
    }
    const recipientMap = new Map<string, { email: string; name: string; source: "onboarded" | "external" }>();
    for (const row of filteredOnboarded.filter((item) => selectedOnboarded[item.id])) {
      recipientMap.set(row.email.toLowerCase(), { email: row.email, name: row.name, source: "onboarded" });
    }
    for (const row of filteredExternal.filter((item) => selectedExternal[item.id])) {
      recipientMap.set(row.email.toLowerCase(), { email: row.email, name: row.name, source: "external" });
    }
    const recipients = Array.from(recipientMap.values());
    if (recipients.length === 0) {
      setErrorMessage("Select at least one recipient.");
      return;
    }
    setSending(true);
    try {
      const result = await onSendDistribution({
        title: title.trim(),
        fileName: fileName || "document.pdf",
        pdfBase64,
        recipients,
      });
      if (!result.ok) {
        setErrorMessage(result.error || "Unable to send document.");
        return;
      }
      if (result.emailErrors && result.emailErrors.length > 0) {
        setStatusMessage(
          `Document saved. ${result.emailErrors.length} email(s) could not be sent — check SMTP configuration.`,
        );
      } else {
        setStatusMessage(`"${title.trim()}" sent to ${recipients.length} recipient(s).`);
      }
      setTitle("");
      setFileName("");
      setPdfBase64("");
      setSelectedOnboarded({});
      setSelectedExternal({});
      if (fileInputRef.current) fileInputRef.current.value = "";
      await onRefreshFromServer();
      setTab("tracking");
    } finally {
      setSending(false);
    }
  };

  const handleAddEmployee = async (event: FormEvent) => {
    event.preventDefault();
    const email = employeeDraft.email.trim().toLowerCase();
    if (!email.includes("@")) {
      setErrorMessage("Enter a valid employee email.");
      return;
    }
    const site = sites.find((item) => item.id === employeeDraft.siteId);
    const next: ExternalEmployee = {
      id: crypto.randomUUID(),
      email,
      name: employeeDraft.name.trim() || email,
      department: employeeDraft.department.trim(),
      siteId: employeeDraft.siteId,
      siteName: site?.name || "",
      active: true,
      createdAt: new Date().toISOString(),
    };
    const merged = [next, ...externalEmployees];
    await onSaveExternalEmployees(merged);
    setEmployeeDraft({ name: "", email: "", department: "", siteId: "" });
    setStatusMessage("Employee added to directory.");
    setErrorMessage("");
  };

  const toggleEmployeeActive = async (employee: ExternalEmployee) => {
    const merged = externalEmployees.map((row) =>
      row.id === employee.id ? { ...row, active: !row.active } : row,
    );
    await onSaveExternalEmployees(merged);
  };

  const ackSummary = (item: DocumentDistribution) => {
    const total = item.recipients.length;
    const done = item.recipients.filter((recipient) => recipient.acknowledgedAt).length;
    return `${done}/${total} acknowledged`;
  };

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-slate-200/90 bg-white/90 p-4 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Upload &amp; training</h1>
        <p className="mt-1 text-sm text-slate-600">
          Send policy updates, toolbox talks, and training PDFs. Recipients confirm read via email.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["send", "tracking", "employees"] as TabId[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                tab === item
                  ? "bg-[var(--bert-signal-orange)] text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              {item === "send" ? "Send document" : item === "tracking" ? "Tracking" : "Employee directory"}
            </button>
          ))}
        </div>
      </header>

      {statusMessage ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{statusMessage}</p>
      ) : null}
      {errorMessage ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{errorMessage}</p>
      ) : null}

      {tab === "send" ? (
        <form onSubmit={handleSend} className="space-y-4">
          <section className="rounded-2xl border border-slate-200/90 bg-white/90 p-4 shadow-sm">
            <label className="block text-sm font-semibold text-slate-800">Name of document</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Q1 policy update"
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </section>

          <section className="rounded-2xl border border-slate-200/90 bg-white/90 p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-800">Add PDF document</p>
            <div
              className="mt-3 flex min-h-[120px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center"
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                void handlePdfFile(file || null);
              }}
            >
              <p className="text-sm text-slate-600">Drag and drop a PDF here, or browse</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Choose PDF
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(event) => void handlePdfFile(event.target.files?.[0] || null)}
              />
              {fileName ? <p className="mt-2 text-xs font-medium text-slate-700">{fileName}</p> : null}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/90 bg-white/90 p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs font-semibold text-slate-600">Site</label>
                <select
                  value={siteFilter}
                  onChange={(event) => setSiteFilter(event.target.value)}
                  className="mt-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                >
                  <option value="All">All sites</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">Department</label>
                <select
                  value={departmentFilter}
                  onChange={(event) => setDepartmentFilter(event.target.value)}
                  className="mt-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                >
                  <option value="All">All departments</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[180px] flex-1">
                <label className="block text-xs font-semibold text-slate-600">Search</label>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name or email"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => toggleAllOnboarded(true)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold">
                Select all onboarded (filtered)
              </button>
              <button type="button" onClick={() => toggleAllExternal(true)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold">
                Select all directory (filtered)
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedOnboarded({});
                  setSelectedExternal({});
                }}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold"
              >
                Clear selection
              </button>
            </div>

            <p className="text-sm font-semibold text-slate-800">Onboarded users</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-2">
              {filteredOnboarded.length === 0 ? (
                <li className="text-xs text-slate-500">No onboarded users match filters.</li>
              ) : (
                filteredOnboarded.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedOnboarded[row.id])}
                      onChange={(event) =>
                        setSelectedOnboarded((current) => ({ ...current, [row.id]: event.target.checked }))
                      }
                    />
                    <span className="font-medium text-slate-800">{row.name}</span>
                    <span className="text-slate-500">{row.email}</span>
                    {row.department ? <span className="text-xs text-slate-400">· {row.department}</span> : null}
                  </li>
                ))
              )}
            </ul>

            <p className="text-sm font-semibold text-slate-800">Employee directory (not onboarded)</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-2">
              {filteredExternal.length === 0 ? (
                <li className="text-xs text-slate-500">No active directory employees match filters. Add them under Employee directory.</li>
              ) : (
                filteredExternal.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedExternal[row.id])}
                      onChange={(event) =>
                        setSelectedExternal((current) => ({ ...current, [row.id]: event.target.checked }))
                      }
                    />
                    <span className="font-medium text-slate-800">{row.name}</span>
                    <span className="text-slate-500">{row.email}</span>
                  </li>
                ))
              )}
            </ul>

            <p className="text-xs text-slate-500">{selectedRecipientCount} recipient(s) selected · Sent by {currentUserName}</p>
          </section>

          <button
            type="submit"
            disabled={sending}
            className="w-full rounded-xl bg-[var(--bert-signal-orange)] py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send document and emails"}
          </button>
        </form>
      ) : null}

      {tab === "tracking" ? (
        <div className="space-y-4">
          {priorityDistributions.length > 0 ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
              <h2 className="text-sm font-semibold text-amber-900">Priority — pending acknowledgments</h2>
              <ul className="mt-2 space-y-2">
                {priorityDistributions.map((item) => (
                  <li key={item.id} className="rounded-lg bg-white/80 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    <p className="text-xs text-amber-800">{ackSummary(item)} · sent {new Date(item.sentAt).toLocaleString("en-GB")}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200/90 bg-white/90 p-4 shadow-sm">
            <label className="block text-sm font-semibold text-slate-800">Search documents</label>
            <input
              value={trackingSearch}
              onChange={(event) => setTrackingSearch(event.target.value)}
              placeholder="Document name, file, or recipient email"
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <ul className="mt-4 space-y-3">
              {filteredTracking.length === 0 ? (
                <li className="text-sm text-slate-500">No documents sent yet.</li>
              ) : (
                filteredTracking.map((item) => (
                  <li key={item.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">{item.title}</p>
                      <span className="text-xs font-medium text-slate-600">{ackSummary(item)}</span>
                    </div>
                    <p className="text-xs text-slate-500">{item.fileName} · {new Date(item.sentAt).toLocaleString("en-GB")}</p>
                    <ul className="mt-2 space-y-1">
                      {item.recipients.map((recipient) => (
                        <li key={`${item.id}-${recipient.email}`} className="flex items-center justify-between text-xs">
                          <span>
                            {recipient.name} ({recipient.email})
                          </span>
                          <span className={recipient.acknowledgedAt ? "text-emerald-700" : "text-amber-700"}>
                            {recipient.acknowledgedAt
                              ? `Read ${new Date(recipient.acknowledgedAt).toLocaleDateString("en-GB")}`
                              : "Pending"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "employees" ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200/90 bg-white/90 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Add employee (not onboarded)</h2>
            <form onSubmit={handleAddEmployee} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                value={employeeDraft.name}
                onChange={(event) => setEmployeeDraft((c) => ({ ...c, name: event.target.value }))}
                placeholder="Full name"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={employeeDraft.email}
                onChange={(event) => setEmployeeDraft((c) => ({ ...c, email: event.target.value }))}
                placeholder="Email"
                type="email"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={employeeDraft.department}
                onChange={(event) => setEmployeeDraft((c) => ({ ...c, department: event.target.value }))}
                placeholder="Department"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <select
                value={employeeDraft.siteId}
                onChange={(event) => setEmployeeDraft((c) => ({ ...c, siteId: event.target.value }))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Site (optional)</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="sm:col-span-2 rounded-xl bg-slate-900 py-2 text-sm font-semibold text-white">
                Add to directory
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200/90 bg-white/90 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Directory</h2>
            <ul className="mt-3 space-y-2">
              {externalEmployees.length === 0 ? (
                <li className="text-sm text-slate-500">No directory employees yet.</li>
              ) : (
                externalEmployees.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">
                        {row.name}{" "}
                        <span className={row.active ? "text-emerald-600" : "text-slate-400"}>
                          ({row.active ? "Active" : "Inactive"})
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.email}
                        {row.department ? ` · ${row.department}` : ""}
                        {row.siteName ? ` · ${row.siteName}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleEmployeeActive(row)}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold"
                    >
                      {row.active ? "Deactivate" : "Activate"}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
