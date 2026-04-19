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
                    <a href="https://converter-hub-eight.vercel.app"
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

module.exports = { sendWelcomeEmail };
