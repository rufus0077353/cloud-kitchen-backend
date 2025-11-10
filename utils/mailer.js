// utils/mailer.js
const nodemailer = require("nodemailer");
const sg = require("@sendgrid/mail");

// prod if NODE_ENV=production OR ENV=prod
const isProd =
  String(process.env.NODE_ENV || "").toLowerCase() === "production" ||
  String(process.env.ENV || "").toLowerCase() === "prod";

// normalize FROM (strip accidental quotes from .env)
function cleanFrom(v) {
  const s = String(v || "").trim();
  return s.replace(/^"+|"+$/g, ""); // remove leading/trailing quotes
}
const FROM = cleanFrom(
  process.env.EMAIL_FROM ||
  process.env.MAIL_FROM ||
  "Servezy <no-reply@servezy.in>"
);

const PROVIDER = (process.env.MAIL_PROVIDER || "sendgrid").toLowerCase();

// allow-list for non-prod
const whitelist = (process.env.WHITELIST_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const canSend = (to) => isProd || whitelist.includes(String(to).toLowerCase());

// --- providers ---
function getTransport() {
  if (PROVIDER === "smtp") {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  const key = process.env.SENDGRID_API_KEY || "";
  if (!key && isProd) console.warn("[mailer] SENDGRID_API_KEY missing in prod");
  sg.setApiKey(key);
  return null;
}

/**
 * sendMail
 * @param {object} opts
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text]
 * @param {string} [opts.category]           // "confirm" | "otp" | "receipt" | "marketing" ...
 * @param {string} [opts.listUnsubURL]       // for marketing
 * @param {boolean} [opts.transactional=true]
 * @param {string} [opts.replyTo]
 */
async function sendMail({
  to,
  subject,
  html,
  text,
  category,
  listUnsubURL,
  transactional = true,
  replyTo,
}) {
  if (!canSend(to)) return { skipped: true, reason: "not-whitelisted" };

  // ---- build safe headers
  const headers = {};
  if (category && typeof category === "string") {
    headers["X-Category"] = category.trim();
  }
  if (!transactional && typeof listUnsubURL === "string") {
    const u = listUnsubURL.trim();
    if (u && /^https?:\/\//i.test(u)) {
      headers["List-Unsubscribe"] = `<${u}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
  }

  // plain-text fallback (helps deliverability)
  const textBody =
    text || (html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "");

  if (PROVIDER === "smtp") {
    const t = getTransport();
    const info = await t.sendMail({
      from: FROM,
      to,
      subject,
      html,
      text: textBody,
      headers,
      ...(replyTo ? { replyTo } : {}),
    });
    return { ok: true, id: info.messageId };
  } else {
    // SendGrid
    const msg = {
      from: FROM,
      to,
      subject,
      html,
      text: textBody,
      headers,
      trackingSettings: transactional
        ? {
            clickTracking: { enable: false, enableText: false },
            openTracking: { enable: false },
          }
        : undefined,
      mailSettings: { bypassListManagement: { enable: transactional } },
      categories: category ? [category] : undefined,
      ...(replyTo ? { replyTo } : {}),
    };
    const [res] = await sg.send(msg);
    return { ok: res.statusCode < 300, id: res.headers["x-message-id"] || "" };
  }
}

module.exports = { sendMail };