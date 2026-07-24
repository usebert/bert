/**
 * Guard outbound email for protected demo companies.
 */
import {
  logSuppressedDemoEmail,
  shouldSuppressDemoOutboundEmail,
} from "../shared/demo-environment.mjs";

/**
 * @returns {{ suppressed: boolean, reason?: string }}
 */
export function guardDemoOutboundEmail(context = {}) {
  const channel = String(context.channel || "email").trim() || "email";
  if (
    shouldSuppressDemoOutboundEmail({
      companyFolderId: context.companyFolderId,
      companyName: context.companyName,
      toEmail: context.toEmail,
      channel,
      env: context.env,
    })
  ) {
    logSuppressedDemoEmail(channel, {
      companyFolderId: context.companyFolderId,
      toEmail: context.toEmail,
      reason: context.reason || "demo environment outbound protection",
    });
    return { suppressed: true, reason: "demo_email_suppressed" };
  }
  return { suppressed: false };
}

/**
 * @template T
 * @param {object} context
 * @param {() => Promise<T>} sendFn
 * @returns {Promise<{ suppressed: true } | { suppressed: false, result: T }>}
 */
export async function sendUnlessDemoSuppressed(context, sendFn) {
  const guard = guardDemoOutboundEmail(context);
  if (guard.suppressed) {
    return { suppressed: true };
  }
  const result = await sendFn();
  return { suppressed: false, result };
}
