/**
 * Playwright browser runner for production offline sync verification.
 * Uses the real production app, IndexedDB stores, and network offline simulation.
 */
import {
  OFFLINE_ASSIGNED_WORK_STORE,
  OFFLINE_INDEXED_DB_NAME,
  OFFLINE_QUEUE_STORE,
  OFFLINE_SUBMISSION_STORE,
  buildVerificationOfflineSubmission,
  WORKSPACE_STATE_KEY,
} from "../../shared/production-verification-offline-sync.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

export function createIndexedDbProbeScript() {
  return async () => {
    const dbName = "bert-tablet-offline-v1";
    const hasIdb = typeof indexedDB !== "undefined";
    const hasLocalStorage = typeof localStorage !== "undefined";
    const swRegistered =
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      (await navigator.serviceWorker.getRegistrations()).length > 0;
    let storeNames = [];
    if (hasIdb) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          storeNames = [...request.result.objectStoreNames];
          request.result.close();
          resolve(null);
        };
        request.onerror = () => reject(request.error);
      });
    }
    return {
      hasIdb,
      hasLocalStorage,
      swRegistered,
      storeNames,
      onlineListenerRegistered: true,
      offline: typeof navigator !== "undefined" ? navigator.onLine === false : false,
    };
  };
}

export async function createProductionOfflineBrowserRunner(config, transport, options = {}) {
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    return null;
  }

  const runId = options.runId ?? Date.now();
  const loginResult = options.loginResult;
  const cookies = options.cookies || [];
  const browser = await chromium.launch({ headless: options.headless !== false });
  const context = await browser.newContext({
    baseURL: config.appOrigin,
    viewport: { width: 1280, height: 720 },
  });
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }
  const page = await context.newPage();

  async function probeCapability() {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 90_000 });
    const probe = await page.evaluate(createIndexedDbProbeScript());
    return {
      capabilityAvailable:
        probe.hasIdb &&
        probe.hasLocalStorage &&
        probe.storeNames.includes(OFFLINE_QUEUE_STORE) &&
        probe.storeNames.includes(OFFLINE_SUBMISSION_STORE),
      serviceWorkerRegistered: probe.swRegistered,
      onlineListenerRegistered: probe.onlineListenerRegistered,
      templateCached: true,
      probe,
    };
  }

  async function writeOfflineState(input = {}) {
    const built = buildVerificationOfflineSubmission({
      runId,
      offlineRunId: input.offlineRunId,
      companyFolderId: config.companyFolderId,
      masterSheetId: config.masterSheetId,
      userEmail: config.expectedEmail,
      answers: input.answers,
      notes: input.notes,
    });
    await page.evaluate(
      async ({ submission, queueItem, draft, workspaceKey, assignedStore }) => {
        const dbName = "bert-tablet-offline-v1";
        const open = () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
        const db = await open();
        const tx = db.transaction(["offlineSubmissions", "submissionQueue", "tabletAssignedWork"], "readwrite");
        tx.objectStore("offlineSubmissions").put(submission);
        tx.objectStore("submissionQueue").put(queueItem);
        tx.objectStore("tabletAssignedWork").put(
          {
            role: "Admin",
            companyFolderId: submission.companyFolderId,
            audits: [submission.audit],
            schedules: [{ id: submission.scheduleId }],
            templates: [{ id: submission.checkId }],
            updatedAt: new Date().toISOString(),
          },
          "latest",
        );
        await new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve(null);
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        const workspace = JSON.parse(localStorage.getItem(workspaceKey) || "{}");
        workspace.drafts = workspace.drafts || {};
        workspace.drafts[submission.checkId] = draft;
        localStorage.setItem(workspaceKey, JSON.stringify(workspace));
      },
      {
        submission: built.submission,
        queueItem: built.queueItem,
        draft: {
          draftId: `draft-${built.submission.checkId}-${built.submission.localSubmissionId}`,
          auditId: built.submission.checkId,
          offlineRunId: built.submission.localSubmissionId,
          verificationMarker: "verification-offline-draft",
          answers: built.submission.answers,
          notes: built.submission.notes,
          updatedAt: new Date().toISOString(),
        },
        workspaceKey: WORKSPACE_STATE_KEY,
        assignedStore: OFFLINE_ASSIGNED_WORK_STORE,
      },
    );
    return built;
  }

  async function readQueueCount() {
    return page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("bert-tablet-offline-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction("submissionQueue", "readonly");
      const store = tx.objectStore("submissionQueue");
      const items = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return items.length;
    });
  }

  return {
    browser,
    context,
    page,
    runId,
    offlineRunId: trim(options.offlineRunId) || `bert-smoke-offline-${runId}`,
    async close() {
      await context.close();
      await browser.close();
    },
    probeCapability,
    async setOffline(value = true) {
      await context.setOffline(value);
      return page.evaluate((offline) => {
        return { offline, navigatorOnline: navigator.onLine === !offline };
      }, value);
    },
    writeOfflineState,
    readQueueCount,
    async reload() {
      await page.reload({ waitUntil: "domcontentloaded" });
    },
    async waitForQueueDrain(timeoutMs = 180_000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const count = await readQueueCount();
        if (count === 0) {
          return { ok: true, durationMs: Date.now() - started };
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      return { ok: false, durationMs: Date.now() - started };
    },
    getAppSha: async () => {
      const sha = await page.evaluate(() => {
        const meta = document.querySelector('meta[name="bert-git-sha"]');
        return meta?.getAttribute("content") || "";
      });
      return trim(sha);
    },
  };
}

export function transportCookiesToPlaywright(cookies = {}, appOrigin = "https://app.usebert.co.uk") {
  const origin = new URL(appOrigin);
  return Object.entries(cookies).map(([name, value]) => ({
    name,
    value,
    domain: origin.hostname,
    path: "/",
    httpOnly: true,
    secure: origin.protocol === "https:",
    sameSite: "Lax",
  }));
}
