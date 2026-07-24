import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MASTER_SESSION_COOKIE } from "./master-auth.mjs";

const COMPANY_SESSION_COOKIE = "bert_company_session";
/** In-app nav is Admin/Manager only; Master may call API when platform session exists. */
const MANAGER_ROLES = new Set(["Admin", "Manager", "Master"]);
const ACK_TOKEN_PATTERN = /^[a-f0-9]{48}$/;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizePdfFileName(value) {
  const base = path.basename(String(value || "document.pdf").trim()) || "document.pdf";
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 180);
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned.replace(/\.pdf$/i, "")}.pdf`;
}

function isPdfBuffer(buffer) {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("utf8") === "%PDF-";
}

function dedupeRecipients(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const email = String(row.email || "")
      .trim()
      .toLowerCase();
    if (!email.includes("@") || seen.has(email)) {
      continue;
    }
    seen.add(email);
    unique.push({ ...row, email });
  }
  return unique;
}

function safeWorkspaceId(value) {
  const id = String(value || "").trim();
  if (!id || !/^[a-zA-Z0-9._-]{1,128}$/.test(id)) {
    return "";
  }
  return id;
}

function storeRoot(sessionDir) {
  return path.join(sessionDir, "document-distributions");
}

function workspaceStorePath(sessionDir, workspaceId) {
  return path.join(storeRoot(sessionDir), `${workspaceId}.json`);
}

function workspaceFilesDir(sessionDir, workspaceId) {
  return path.join(storeRoot(sessionDir), "files", workspaceId);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readWorkspaceStore(sessionDir, workspaceId) {
  const filePath = workspaceStorePath(sessionDir, workspaceId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      externalEmployees: Array.isArray(parsed.externalEmployees) ? parsed.externalEmployees : [],
      distributions: Array.isArray(parsed.distributions) ? parsed.distributions : [],
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { externalEmployees: [], distributions: [] };
    }
    throw error;
  }
}

async function writeWorkspaceStore(sessionDir, workspaceId, store) {
  await ensureDir(storeRoot(sessionDir));
  await fs.writeFile(workspaceStorePath(sessionDir, workspaceId), JSON.stringify(store, null, 2), "utf8");
}

function parseJsonCookie(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readManagerSession(req) {
  const companyRaw = req.signedCookies?.[COMPANY_SESSION_COOKIE];
  const company = parseJsonCookie(companyRaw);
  if (company?.v === 1 && company.email && company.role && MANAGER_ROLES.has(company.role)) {
    return {
      email: String(company.email).toLowerCase(),
      name: String(company.name || company.email),
      role: company.role,
    };
  }
  const masterRaw = req.signedCookies?.[MASTER_SESSION_COOKIE];
  const master = parseJsonCookie(masterRaw);
  if (master?.v === 1 && master.email) {
    return {
      email: String(master.email).toLowerCase(),
      name: String(master.name || master.email),
      role: "Master",
    };
  }
  if (process.env.NODE_ENV !== "production") {
    const devRole = String(req.headers["x-bert-dev-user-role"] || "").trim();
    if (MANAGER_ROLES.has(devRole)) {
      const devEmail = String(req.headers["x-bert-dev-user-email"] || "dev@local.test")
        .trim()
        .toLowerCase();
      const devName = String(req.headers["x-bert-dev-user-name"] || "Dev user").trim();
      return { email: devEmail, name: devName, role: devRole };
    }
  }
  return null;
}

function requireDocumentManager(req, res, next) {
  const session = readManagerSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: "Sign in as Admin or Manager to manage documents." });
  }
  if (!MANAGER_ROLES.has(session.role)) {
    return res.status(403).json({ ok: false, error: "Admin or Manager access required." });
  }
  req.documentManager = session;
  return next();
}

function findRecipientByToken(store, token) {
  for (const distribution of store.distributions) {
    for (const recipient of distribution.recipients) {
      if (recipient.acknowledgeToken === token) {
        return { distribution, recipient };
      }
    }
  }
  return null;
}

function ackDisclaimerHtml() {
  return `<p style="color:#475569;font-size:14px;line-height:1.5;">By pressing the <strong>Read</strong> button, you confirm you have read and understood the document.</p>`;
}

function renderAckPage({ title, token, alreadyAcknowledged, error }) {
  const safeTitle = escapeHtml(title);
  const safeError = escapeHtml(error);
  if (error) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Document acknowledgment</title></head><body style="font-family:system-ui,sans-serif;padding:24px;max-width:520px;margin:0 auto;"><h1>Unable to open document</h1><p>${safeError}</p></body></html>`;
  }
  if (alreadyAcknowledged) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Already acknowledged</title></head><body style="font-family:system-ui,sans-serif;padding:24px;max-width:520px;margin:0 auto;"><h1>Thank you</h1><p>You have already confirmed that you read <strong>${safeTitle}</strong>.</p></body></html>`;
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Confirm read — ${safeTitle}</title></head><body style="font-family:system-ui,sans-serif;padding:24px;max-width:520px;margin:0 auto;"><h1>${safeTitle}</h1><p>Please confirm you have read this document.</p>${ackDisclaimerHtml()}<form method="post" action="/api/documents/ack/${token}" style="margin-top:20px;"><button type="submit" style="background:#ea580c;color:#fff;border:none;padding:12px 20px;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;">Read — I have read and understood</button></form></body></html>`;
}

function renderAckSuccessPage(title) {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Acknowledged</title></head><body style="font-family:system-ui,sans-serif;padding:24px;max-width:520px;margin:0 auto;"><h1>Thank you</h1><p>Your acknowledgment for <strong>${safeTitle}</strong> has been recorded.</p></body></html>`;
}

/**
 * @param {import("express").Express} app
 * @param {{ sessionDir: string; emailConfigured: () => boolean; createSmtpTransport: () => import("nodemailer").Transporter; getFromAddress: () => string; getApiPublicOrigin: () => string; appBrandName: string }} deps
 */
export function installDocumentDistributionRoutes(app, deps) {
  const { sessionDir, emailConfigured, createSmtpTransport, getFromAddress, getApiPublicOrigin, appBrandName } = deps;

  async function sendDocumentAckEmail({ toEmail, recipientName, documentTitle, ackUrl, companyFolderId = "" }) {
    if (!emailConfigured()) {
      throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL.");
    }
    const { guardDemoOutboundEmail } = await import("./demo-email-guard.mjs");
    if (
      guardDemoOutboundEmail({
        channel: "document-acknowledgement",
        toEmail,
        companyFolderId,
      }).suppressed
    ) {
      return { suppressed: true };
    }
    const transporter = createSmtpTransport();
    const subject = `${appBrandName}: Please read — ${documentTitle}`;
    const textBody = [
      `Hello${recipientName ? ` ${recipientName}` : ""},`,
      "",
      `You have been sent a document to read: "${documentTitle}".`,
      "",
      "By pressing the Read button, you confirm you have read and understood the document.",
      "",
      `Open and confirm: ${ackUrl}`,
    ].join("\n");
    const htmlBody = `
      <p>Hello${recipientName ? ` ${recipientName}` : ""},</p>
      <p>You have been sent a document to read: <strong>${documentTitle}</strong>.</p>
      ${ackDisclaimerHtml()}
      <p style="margin:24px 0;"><a href="${ackUrl}" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">Read — I have read and understood</a></p>
      <p style="color:#64748b;font-size:13px;">If the button does not work, copy this link:<br/><a href="${ackUrl}">${ackUrl}</a></p>
    `;
    await transporter.sendMail({
      from: getFromAddress(),
      to: toEmail,
      subject,
      text: textBody,
      html: htmlBody,
    });
  }

  app.get("/api/documents/ack/:token", async (req, res) => {
    try {
      const token = String(req.params.token || "").trim();
      if (!token || !ACK_TOKEN_PATTERN.test(token)) {
        return res.status(400).send(renderAckPage({ error: "Invalid link." }));
      }
      const entries = await fs.readdir(storeRoot(sessionDir)).catch(() => []);
      for (const file of entries) {
        if (!file.endsWith(".json")) {
          continue;
        }
        const workspaceId = file.replace(/\.json$/, "");
        const store = await readWorkspaceStore(sessionDir, workspaceId);
        const match = findRecipientByToken(store, token);
        if (match) {
          const alreadyAcknowledged = Boolean(match.recipient.acknowledgedAt);
          return res.type("html").send(
            renderAckPage({
              title: match.distribution.title,
              token,
              alreadyAcknowledged,
            }),
          );
        }
      }
      return res.status(404).send(renderAckPage({ error: "This acknowledgment link is invalid or has expired." }));
    } catch (error) {
      console.error("[documents] ack page failed:", error);
      return res.status(500).send(renderAckPage({ error: "Unable to load acknowledgment page." }));
    }
  });

  app.post("/api/documents/ack/:token", async (req, res) => {
    try {
      const token = String(req.params.token || "").trim();
      if (!token || !ACK_TOKEN_PATTERN.test(token)) {
        return res.status(400).send(renderAckPage({ error: "Invalid link." }));
      }
      const files = await fs.readdir(storeRoot(sessionDir)).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue;
        }
        const workspaceId = file.replace(/\.json$/, "");
        const store = await readWorkspaceStore(sessionDir, workspaceId);
        const match = findRecipientByToken(store, token);
        if (!match) {
          continue;
        }
        if (!match.recipient.acknowledgedAt) {
          match.recipient.acknowledgedAt = new Date().toISOString();
          await writeWorkspaceStore(sessionDir, workspaceId, store);
        }
        return res.type("html").send(renderAckSuccessPage(match.distribution.title));
      }
      return res.status(404).send(renderAckPage({ error: "This acknowledgment link is invalid or has expired." }));
    } catch (error) {
      console.error("[documents] ack post failed:", error);
      return res.status(500).send(renderAckPage({ error: "Unable to record acknowledgment." }));
    }
  });

  app.get("/api/documents/distributions", requireDocumentManager, async (req, res) => {
    try {
      const workspaceId = safeWorkspaceId(req.query.workspaceId);
      if (!workspaceId) {
        return res.status(400).json({ ok: false, error: "workspaceId is required." });
      }
      const store = await readWorkspaceStore(sessionDir, workspaceId);
      const distributions = store.distributions.map((item) => ({
        ...item,
        recipients: item.recipients.map((recipient) => ({
          email: recipient.email,
          name: recipient.name,
          source: recipient.source,
          acknowledgedAt: recipient.acknowledgedAt,
        })),
      }));
      return res.json({ ok: true, distributions, externalEmployees: store.externalEmployees });
    } catch (error) {
      console.error("[documents] list failed:", error);
      return res.status(500).json({ ok: false, error: "Unable to load documents." });
    }
  });

  app.put("/api/documents/external-employees", requireDocumentManager, async (req, res) => {
    try {
      const workspaceId = safeWorkspaceId(req.body?.workspaceId);
      if (!workspaceId) {
        return res.status(400).json({ ok: false, error: "workspaceId is required." });
      }
      const externalEmployees = Array.isArray(req.body?.externalEmployees) ? req.body.externalEmployees : [];
      const store = await readWorkspaceStore(sessionDir, workspaceId);
      store.externalEmployees = externalEmployees
        .map((row) => ({
          id: String(row.id || crypto.randomUUID()),
          email: String(row.email || "")
            .trim()
            .toLowerCase(),
          name: String(row.name || "").trim(),
          department: String(row.department || "").trim(),
          siteId: String(row.siteId || "").trim(),
          siteName: String(row.siteName || "").trim(),
          active: row.active !== false,
          createdAt: String(row.createdAt || new Date().toISOString()),
        }))
        .filter((row) => row.email.includes("@"));
      await writeWorkspaceStore(sessionDir, workspaceId, store);
      return res.json({ ok: true, externalEmployees: store.externalEmployees });
    } catch (error) {
      console.error("[documents] external employees save failed:", error);
      return res.status(500).json({ ok: false, error: "Unable to save employee list." });
    }
  });

  app.post("/api/documents/distributions", requireDocumentManager, async (req, res) => {
    try {
      const workspaceId = safeWorkspaceId(req.body?.workspaceId);
      const title = String(req.body?.title || "").trim();
      const fileName = sanitizePdfFileName(req.body?.fileName);
      const pdfBase64 = String(req.body?.pdfBase64 || "").trim();
      const recipientsInput = Array.isArray(req.body?.recipients) ? req.body.recipients : [];

      if (!workspaceId) {
        return res.status(400).json({ ok: false, error: "workspaceId is required." });
      }
      if (!title) {
        return res.status(400).json({ ok: false, error: "Document name is required." });
      }
      if (!pdfBase64) {
        return res.status(400).json({ ok: false, error: "PDF file is required." });
      }
      if (recipientsInput.length === 0) {
        return res.status(400).json({ ok: false, error: "Select at least one recipient." });
      }

      const pdfBuffer = Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
      if (pdfBuffer.length < 32) {
        return res.status(400).json({ ok: false, error: "PDF file is invalid or empty." });
      }
      if (pdfBuffer.length > 15 * 1024 * 1024) {
        return res.status(400).json({ ok: false, error: "PDF must be 15 MB or smaller." });
      }
      if (!isPdfBuffer(pdfBuffer)) {
        return res.status(400).json({ ok: false, error: "Only PDF files are accepted." });
      }

      const distributionId = crypto.randomUUID();
      const filesDir = workspaceFilesDir(sessionDir, workspaceId);
      await ensureDir(filesDir);
      const storedFileName = `${distributionId}.pdf`;
      const storedFilePath = path.join(filesDir, storedFileName);
      await fs.writeFile(storedFilePath, pdfBuffer);

      const apiOrigin = getApiPublicOrigin();
      const recipients = dedupeRecipients(
        recipientsInput.map((row) => ({
          email: String(row.email || "")
            .trim()
            .toLowerCase(),
          name: String(row.name || "").trim(),
          source: row.source === "external" ? "external" : "onboarded",
          acknowledgeToken: crypto.randomBytes(24).toString("hex"),
          acknowledgedAt: null,
        })),
      );

      if (recipients.length === 0) {
        return res.status(400).json({ ok: false, error: "No valid recipient emails." });
      }

      const distribution = {
        id: distributionId,
        workspaceId,
        title,
        fileName,
        storedFileName,
        sentAt: new Date().toISOString(),
        sentBy: String(req.documentManager.name || req.documentManager.email),
        sentByEmail: req.documentManager.email,
        recipients,
      };

      const store = await readWorkspaceStore(sessionDir, workspaceId);
      store.distributions = [distribution, ...store.distributions];
      await writeWorkspaceStore(sessionDir, workspaceId, store);

      const emailErrors = [];
      for (const recipient of recipients) {
        const ackUrl = `${apiOrigin}/api/documents/ack/${recipient.acknowledgeToken}`;
        try {
          await sendDocumentAckEmail({
            toEmail: recipient.email,
            recipientName: recipient.name,
            documentTitle: title,
            ackUrl,
          });
        } catch (error) {
          emailErrors.push({
            email: recipient.email,
            error: error instanceof Error ? error.message : "Send failed",
          });
        }
      }

      const responseDistribution = {
        ...distribution,
        recipients: distribution.recipients.map((recipient) => ({
          email: recipient.email,
          name: recipient.name,
          source: recipient.source,
          acknowledgedAt: recipient.acknowledgedAt,
        })),
      };

      return res.json({
        ok: true,
        distribution: responseDistribution,
        emailErrors,
        smtpConfigured: emailConfigured(),
      });
    } catch (error) {
      console.error("[documents] send failed:", error);
      return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to send document." });
    }
  });
}
