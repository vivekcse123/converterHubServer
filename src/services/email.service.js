"use strict";

const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

let _transporter = null;

const getTransporter = () => {
  if (_transporter) return _transporter;

  const user = process.env.MAIL_USER || process.env.SMTP_USER;
  const pass = process.env.MAIL_PASS || process.env.SMTP_PASS;

  if (!user || !pass) {
    logger.warn("Email skipped — MAIL_USER / MAIL_PASS not configured");
    return null;
  }

  _transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  return _transporter;
};

const FROM = () =>
  process.env.SMTP_FROM || `ApnaConverter <${process.env.MAIL_USER || process.env.SMTP_USER}>`;

/**
 * Send a welcome email to a newly registered user.
 * Fire-and-forget — never blocks the registration response.
 */
const sendWelcomeEmail = async (user) => {
  const transporter = getTransporter();
  if (!transporter) return;

  try {
    await transporter.sendMail({
      from: FROM(),
      to: user.email,
      subject: "Welcome to ApnaConverter! 🎉",
      html: buildWelcomeHtml(user.name),
    });
    logger.info(`Welcome email sent to ${user.email}`);
  } catch (err) {
    logger.warn(`Failed to send welcome email to ${user.email}: ${err.message}`);
  }
};

// ── Email Templates ───────────────────────────────────────────────────────────

const buildWelcomeHtml = (name) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ApnaConverter</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:12px;overflow:hidden;
                      box-shadow:0 4px 24px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                        padding:40px 48px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;
                          letter-spacing:-0.5px;">
                ✨ ApnaConverter
              </h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:15px;">
                Universal File Conversion Platform
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:48px;">
              <h2 style="margin:0 0 16px;color:#1e1b4b;font-size:22px;font-weight:600;">
                Welcome aboard, ${escapeHtml(name)}! 👋
              </h2>
              <p style="margin:0 0 20px;color:#4b5563;font-size:16px;line-height:1.6;">
                Your account is all set. Here's what you can do with ApnaConverter:
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                ${featureRow("🖼️", "Image Conversion", "Convert between JPG, PNG, WebP, AVIF and more.")}
                ${featureRow("📄", "PDF Tools", "Merge, split, compress and convert PDFs instantly.")}
                ${featureRow("📊", "Office Documents", "Transform Word, Excel and PowerPoint files with ease.")}
                ${featureRow("🗜️", "File Compression", "Reduce file sizes without losing quality.")}
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://www.apnaconverter.com"
                       style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                              color:#ffffff;text-decoration:none;padding:14px 40px;
                              border-radius:8px;font-size:16px;font-weight:600;
                              letter-spacing:0.3px;">
                      Start Converting →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:24px 48px;text-align:center;
                        border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.5;">
                You're receiving this because you created an account at ApnaConverter.<br/>
                Questions? Reply to this email — we're happy to help.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const featureRow = (icon, title, desc) => `
  <tr>
    <td style="padding:10px 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="44" valign="top">
            <span style="font-size:22px;">${icon}</span>
          </td>
          <td valign="top">
            <p style="margin:0;color:#1e1b4b;font-size:15px;font-weight:600;">${title}</p>
            <p style="margin:2px 0 0;color:#6b7280;font-size:14px;">${desc}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Send a password-reset email containing a one-time link (expires in 1 hour).
 */
const sendPasswordResetEmail = async (user, rawToken) => {
  const transporter = getTransporter();
  if (!transporter) {
    const err = new Error('Email service not configured — set MAIL_USER and MAIL_PASS environment variables.');
    logger.error(`Password reset email failed for ${user.email}: ${err.message}`);
    throw err;
  }

  const resetUrl = `${process.env.APP_URL || 'https://www.apnaconverter.com'}/reset-password/${rawToken}`;

  try {
    await transporter.sendMail({
      from: FROM(),
      to: user.email,
      subject: 'Reset your ApnaConverter password',
      html: buildPasswordResetHtml(user.name, resetUrl),
    });
    logger.info(`Password reset email sent to ${user.email}`);
  } catch (err) {
    logger.warn(`Failed to send password reset email to ${user.email}: ${err.message}`);
    throw err;
  }
};

const buildPasswordResetHtml = (name, resetUrlRaw) => {
  // Escape both user-controlled values before interpolating into HTML
  const safeName    = escapeHtml(name);
  const safeResetUrl = escapeHtml(resetUrlRaw);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Reset your password</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <tr><td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:40px 48px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:28px;font-weight:700;">🔐 ApnaConverter</h1>
        </td></tr>
        <tr><td style="padding:48px;">
          <h2 style="margin:0 0 16px;color:#1e1b4b;font-size:22px;font-weight:600;">Password reset request</h2>
          <p style="margin:0 0 12px;color:#4b5563;font-size:16px;line-height:1.6;">Hi ${safeName},</p>
          <p style="margin:0 0 24px;color:#4b5563;font-size:16px;line-height:1.6;">
            We received a request to reset your password. Click the button below to choose a new one.
            This link expires in <strong>1 hour</strong>.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
            <tr><td align="center">
              <a href="${safeResetUrl}"
                 style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                        color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;
                        font-size:16px;font-weight:600;">Reset My Password →</a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;color:#6b7280;font-size:14px;">If the button doesn't work, copy this link:</p>
          <p style="margin:0 0 24px;word-break:break-all;">
            <a href="${safeResetUrl}" style="color:#6366f1;font-size:13px;">${safeResetUrl}</a>
          </p>
          <p style="margin:0;color:#9ca3af;font-size:14px;line-height:1.6;">
            If you didn't request this, you can safely ignore this email — your password won't change.
          </p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:24px 48px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:13px;">This link expires in 1 hour for your security.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
};

/**
 * Send a subscription expiry reminder email.
 * Called by the nightly cron job for users expiring in 7 days or 1 day.
 */
const sendExpiryReminderEmail = async (user, daysLeft) => {
  const transporter = getTransporter();
  if (!transporter) return;
  const urgency = daysLeft === 1 ? "expires TOMORROW" : `expires in ${daysLeft} days`;
  const subject  = daysLeft === 1
    ? "⚠️ Your ApnaConverter Pro plan expires tomorrow"
    : `Your ApnaConverter Pro plan expires in ${daysLeft} days`;
  try {
    await transporter.sendMail({
      from: FROM(),
      to: user.email,
      subject,
      html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:32px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">Your Pro Plan ${urgency}</h1>
        </div>
        <div style="padding:28px 24px;">
          <p style="color:#475569;margin:0 0 16px;">Hi ${user.name?.split(" ")[0] || "there"},</p>
          <p style="color:#475569;margin:0 0 20px;">Your <strong>ApnaConverter Pro</strong> subscription ${urgency}. Renew now to keep:</p>
          <ul style="color:#475569;margin:0 0 24px;padding-left:20px;line-height:1.8;">
            <li>14 premium resume templates</li>
            <li>Cover Letter Builder</li>
            <li>Portfolio with public URL</li>
            <li>Job Application Tracker</li>
            <li>AI Writing Assistant</li>
            <li>No watermark on PDF downloads</li>
          </ul>
          <div style="text-align:center;margin:24px 0;">
            <a href="${process.env.APP_URL || "https://www.apnaconverter.com"}/resume-builder/pricing"
               style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">
              Renew My Pro Plan →
            </a>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin:0;text-align:center;">
            If you choose not to renew, your account will revert to the free plan and your Pro features will be paused.
          </p>
        </div>
      </div>`,
    });
    logger.info(`Expiry reminder sent to ${user.email} (${daysLeft}d left)`);
  } catch (err) {
    logger.error(`Failed to send expiry reminder to ${user.email}:`, err.message);
  }
};

module.exports = { sendWelcomeEmail, sendPasswordResetEmail, sendExpiryReminderEmail };
