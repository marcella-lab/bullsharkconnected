import type { PortalUser } from "../src/types.js";

type AccountEmailKind = "invitation" | "password_reset";

export interface AccountEmailResult {
  sent: boolean;
  reason?: string;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[character] || character));

const appUrl = () => (process.env.APP_URL || "https://portal.bullsharkconnected.org").replace(/\/$/, "");

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<AccountEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { sent: false, reason: "Email delivery is not configured." };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    if (!response.ok) {
      console.error("Email delivery failed:", response.status, await response.text());
      return { sent: false, reason: "Email provider rejected delivery." };
    }
    return { sent: true };
  } catch (error) {
    console.error("Email delivery error:", error);
    return { sent: false, reason: "Email delivery could not be completed." };
  }
}

/**
 * Delivers account emails with Resend's HTTPS API.  The API key is read only
 * on the server, never returned to the portal, and may be left unset locally.
 */
export async function sendAccountEmail(user: PortalUser, kind: AccountEmailKind, temporaryPassword: string): Promise<AccountEmailResult> {
  const portalUrl = appUrl();
  const reset = kind === "password_reset";
  const subject = reset ? "Your BullShark Connected password was reset" : "You’ve been invited to BullShark Connected";
  const greeting = user.firstName || user.name || "there";
  const message = reset
    ? "An administrator reset your BullShark Connected password."
    : "You’ve been invited to BullShark Connected.";
  const roleName = user.role === "subcontractor" ? "Subcontractor" : user.role === "project_manager" ? "Project Manager" : user.role === "admin" ? "Admin" : "Client";
  const text = `${message}\n\nSign in: ${portalUrl}\nEmail: ${user.email}\nTemporary password: ${temporaryPassword}\n\nYou will be required to create a new password after you sign in.\n\nRole: ${roleName}`;
  const html = `<main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0f2a3a"><div style="padding:26px 30px;background:#0f2a3a;color:#fff"><strong style="font-size:22px;letter-spacing:.5px">BULLSHARK CONNECTED</strong></div><div style="padding:30px;background:#fff;border:1px solid #d2dee3"><h1 style="margin:0 0 16px;color:#0f2a3a;font-size:25px">${escapeHtml(subject)}</h1><p>Hi ${escapeHtml(greeting)},</p><p>${escapeHtml(message)}</p><p>Use the information below to sign in. For security, you must create a new password immediately after your first sign-in.</p><div style="margin:22px 0;padding:18px;background:#eaf4f6;border-left:4px solid #12b8c9"><div><strong>Email</strong><br>${escapeHtml(user.email)}</div><div style="margin-top:12px"><strong>Temporary password</strong><br><code style="font-size:17px">${escapeHtml(temporaryPassword)}</code></div></div><p><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:12px 18px;background:#12b8c9;color:#0f2a3a;text-decoration:none;font-weight:bold;border-radius:5px">Sign in to BullShark Connected</a></p><p style="font-size:13px;color:#526875">Your access type: ${escapeHtml(roleName)}</p></div></main>`;
  return sendEmail(user.email, subject, html, text);
}

/** Delivers regular portal notifications when the admin has enabled email for that event type. */
export async function sendNotificationEmail(user: PortalUser, title: string, detail: string, href: string): Promise<AccountEmailResult> {
  const greeting = user.firstName || user.name || "there";
  const destination = `${appUrl()}/?view=${encodeURIComponent(href)}`;
  const text = `${title}\n\nHi ${greeting},\n${detail}\n\nOpen BullShark Connected: ${destination}`;
  const html = `<main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0f2a3a"><div style="padding:26px 30px;background:#0f2a3a;color:#fff"><strong style="font-size:22px;letter-spacing:.5px">BULLSHARK CONNECTED</strong></div><div style="padding:30px;background:#fff;border:1px solid #d2dee3"><h1 style="margin:0 0 16px;color:#0f2a3a;font-size:25px">${escapeHtml(title)}</h1><p>Hi ${escapeHtml(greeting)},</p><p>${escapeHtml(detail)}</p><p><a href="${escapeHtml(destination)}" style="display:inline-block;padding:12px 18px;background:#12b8c9;color:#0f2a3a;text-decoration:none;font-weight:bold;border-radius:5px">Open BullShark Connected</a></p></div></main>`;
  return sendEmail(user.email, title, html, text);
}
