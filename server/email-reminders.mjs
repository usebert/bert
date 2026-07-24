/**
 * Personal email reminders for signed-in users (ops / pilot).
 * Stored under BERT_SESSIONS_DIR; sent via existing SMTP when due.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MASTER_SESSION_COOKIE } from "./master-auth.mjs";

const COMPANY_SESSION_COOKIE = "bert_company_session";
const STORE_DIR = "email-reminders";
const STORE_FILE = "reminders.json";
const MAX_MESSAGE_LEN = 2000;
const MAX_PENDING_PER_USER = 50;
const MIN_LEAD_MS = 60_000;
const TICK_MS = 60_000;

function storePath(sessionDir) {
  return path.join(sessionDir, STORE_DIR, STORE_FILE);
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

function readAuthenticatedSession(req) {
  const company = parseJsonCookie(req.signedCookies?.[COMPANY_SESSION_COOKIE]);
  if (company?.v === 1 && company.email) {
    return {
      email: String(company.email).toLowerCase(),
      name: String(company.name || company.email),
      role: String(company.role || ""),
    };
  }
  const master = parseJsonCookie(req.signedCookies?.[MASTER_SESSION_COOKIE]);
  if (master?.v === 1 && master.email) {
    return {
      email: String(master.email).toLowerCase(),
      name: String(master.name || master.email),
      role: "Master",
    };
  }
  if (process.env.NODE_ENV !== "production") {
    const devEmail = String(req.headers["x-bert-dev-user-email"] || "dev@local.test")
      .trim()
      .toLowerCase();
    if (devEmail.includes("@")) {
      return {
        email: devEmail,
        name: String(req.headers["x-bert-dev-user-name"] || "Dev user").trim(),
        role: String(req.headers["x-bert-dev-user-role"] || "Admin").trim(),
      };
    }
  }
  return null;
}

function readStore(sessionDir) {
  const p = storePath(sessionDir);
  try {
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !Array.isArray(data.reminders)) {
      return { version: 1, reminders: [] };
    }
    return { version: 1, reminders: data.reminders };
  } catch {
    return { version: 1, reminders: [] };
  }
}

function writeStore(sessionDir, store) {
  const dir = path.join(sessionDir, STORE_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(storePath(sessionDir), JSON.stringify(store, null, 2), "utf8");
}

function parseRemindAt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const s = String(value || "").trim();
  if (!s) {
    return NaN;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : NaN;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function requireReminderSession(req, res, next) {
  const session = readAuthenticatedSession(req);
  if (!session?.email) {
    return res.status(401).json({ ok: false, error: "Sign in to manage email reminders." });
  }
  req.reminderUser = session;
  return next();
}

/**
 * @param {import("express").Express} app
 * @param {{ sessionDir: string; emailConfigured: () => boolean; createSmtpTransport: () => import("nodemailer").Transporter; getFromAddress: () => string; appBrandName: string; getFrontendUrl: () => string }} deps
 */
export function installEmailReminderRoutes(app, deps) {
  const { sessionDir, emailConfigured, createSmtpTransport, getFromAddress, appBrandName, getFrontendUrl } = deps;

  app.get("/api/reminders", requireReminderSession, (req, res) => {
    const email = req.reminderUser.email;
    const store = readStore(sessionDir);
    const reminders = store.reminders
      .filter((r) => String(r.ownerEmail || "").toLowerCase() === email)
      .map((r) => ({
        id: r.id,
        message: r.message,
        remindAt: r.remindAt,
        status: r.status,
        createdAt: r.createdAt,
        sentAt: r.sentAt ?? null,
      }))
      .sort((a, b) => a.remindAt - b.remindAt);
    return res.json({
      ok: true,
      reminders,
      smtpConfigured: emailConfigured(),
    });
  });

  app.post("/api/reminders", requireReminderSession, (req, res) => {
    if (!emailConfigured()) {
      return res.status(503).json({
        ok: false,
        error: "Email is not configured on the server. Add SMTP settings to send reminders.",
      });
    }
    const message = String(req.body?.message || "").trim();
    const remindAt = parseRemindAt(req.body?.remindAt);
    if (!message) {
      return res.status(400).json({ ok: false, error: "Message is required." });
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return res.status(400).json({ ok: false, error: `Message must be at most ${MAX_MESSAGE_LEN} characters.` });
    }
    if (!Number.isFinite(remindAt)) {
      return res.status(400).json({ ok: false, error: "A valid remindAt date/time is required." });
    }
    if (remindAt < Date.now() + MIN_LEAD_MS) {
      return res.status(400).json({ ok: false, error: "Reminder time must be at least one minute in the future." });
    }

    const ownerEmail = req.reminderUser.email;
    const store = readStore(sessionDir);
    const pendingCount = store.reminders.filter(
      (r) => String(r.ownerEmail || "").toLowerCase() === ownerEmail && r.status === "pending",
    ).length;
    if (pendingCount >= MAX_PENDING_PER_USER) {
      return res.status(400).json({
        ok: false,
        error: `You can have at most ${MAX_PENDING_PER_USER} pending reminders.`,
      });
    }

    const reminder = {
      id: crypto.randomUUID(),
      ownerEmail,
      ownerName: req.reminderUser.name,
      message,
      remindAt,
      status: "pending",
      createdAt: Date.now(),
      sentAt: null,
    };
    store.reminders.push(reminder);
    writeStore(sessionDir, store);
    return res.status(201).json({
      ok: true,
      reminder: {
        id: reminder.id,
        message: reminder.message,
        remindAt: reminder.remindAt,
        status: reminder.status,
        createdAt: reminder.createdAt,
        sentAt: null,
      },
    });
  });

  app.delete("/api/reminders/:id", requireReminderSession, (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ ok: false, error: "Reminder id is required." });
    }
    const ownerEmail = req.reminderUser.email;
    const store = readStore(sessionDir);
    const idx = store.reminders.findIndex(
      (r) => r.id === id && String(r.ownerEmail || "").toLowerCase() === ownerEmail,
    );
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: "Reminder not found." });
    }
    if (store.reminders[idx].status === "sent") {
      return res.status(400).json({ ok: false, error: "Sent reminders cannot be deleted." });
    }
    store.reminders.splice(idx, 1);
    writeStore(sessionDir, store);
    return res.json({ ok: true });
  });

  async function sendReminderEmail(reminder) {
    const { guardDemoOutboundEmail } = await import("./demo-email-guard.mjs");
    if (
      guardDemoOutboundEmail({
        channel: "user-reminder",
        toEmail: reminder.ownerEmail,
        companyFolderId: reminder.companyFolderId || reminder.companyId,
      }).suppressed
    ) {
      return { suppressed: true };
    }
    const transporter = createSmtpTransport();
    const subjectPreview = reminder.message.length > 60 ? `${reminder.message.slice(0, 57)}…` : reminder.message;
    const frontend = String(getFrontendUrl() || "").trim();
    const appLink = frontend ? `<p style="margin-top:16px;"><a href="${escapeHtml(frontend)}">Open ${escapeHtml(appBrandName)}</a></p>` : "";
    const html = `<!DOCTYPE html><html lang="en"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a;">
<p>Hi ${escapeHtml(reminder.ownerName || reminder.ownerEmail)},</p>
<p>This is your scheduled reminder from <strong>${escapeHtml(appBrandName)}</strong>:</p>
<p style="font-size:16px;padding:12px 16px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">${escapeHtml(reminder.message)}</p>
${appLink}
<p style="color:#64748b;font-size:13px;margin-top:24px;">You scheduled this reminder in BERT.</p>
</body></html>`;
    await transporter.sendMail({
      from: getFromAddress(),
      to: reminder.ownerEmail,
      subject: `${appBrandName} reminder: ${subjectPreview}`,
      text: `${reminder.message}\n\n— ${appBrandName}`,
      html,
    });
  }

  async function processDueReminders() {
    if (!emailConfigured()) {
      return { sent: 0 };
    }
    const store = readStore(sessionDir);
    const now = Date.now();
    let sent = 0;
    for (const reminder of store.reminders) {
      if (reminder.status !== "pending" || reminder.remindAt > now) {
        continue;
      }
      try {
        await sendReminderEmail(reminder);
        reminder.status = "sent";
        reminder.sentAt = Date.now();
        sent += 1;
        console.log(`[reminders] sent ${reminder.id} to ${reminder.ownerEmail}`);
      } catch (error) {
        console.error(
          `[reminders] failed ${reminder.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    if (sent > 0) {
      writeStore(sessionDir, store);
    }
    return { sent };
  }

  return { processDueReminders };
}

/**
 * @param {{ processDueReminders: () => Promise<{ sent: number }> }} runner
 */
export function startEmailReminderScheduler(runner) {
  const tick = () => {
    void runner.processDueReminders().catch((error) => {
      console.error("[reminders] scheduler tick failed:", error instanceof Error ? error.message : error);
    });
  };
  setInterval(tick, TICK_MS);
  tick();
}
