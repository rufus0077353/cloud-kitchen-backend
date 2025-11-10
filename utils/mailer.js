
// utils/mailer.js
const nodemailer = require("nodemailer");
const sg = require("@sendgrid/mail");

// prod if NODE_ENV=production OR ENV=prod
const isProd =
  String(process.env.NODE_ENV || "").toLowerCase() === "production" ||
  String(process.env.ENV || "").toLowerCase() === "prod";

// allow both env names
const FROM =
  (process.env.EMAIL_FROM || process.env.MAIL_FROM || "").trim() ||
  "Servezy <no-reply@example.com>";

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
      host: (process.env.SMTP_HOST || "").trim(),
      port: Number((process.env.SMTP_PORT || "587").trim()),
      secure: false,
      auth: {
        user: (process.env.SMTP_USER || "").trim(),
        pass: (process.env.SMTP_PASS || "").trim(),
      },
    });
  }
  // default: SendGrid
  const raw = process.env.SENDGRID_API_KEY || "";
  // 🔒 strip any quotes/newlines/spaces that break the Authorization header
  const key = raw.replace(/["'\r\n\t ]+/g, "").trim();
  if (!key) {
    console.warn("[mailer] SENDGRID_API_KEY is empty after trimming");
  }
  sg.setApiKey(key);
  return null;
}

// --- send core ---
async function sendMail({
  to,
  subject,
  html,
  text,
  category,
  listUnsubURL,
  transactional = true,
}) {
  if (!canSend(to)) return { skipped: true, reason: "not-whitelisted" };

  const headers = {};
  if (category) headers["X-Category"] = category;
  if (!transactional && listUnsubURL) {
    headers["List-Unsubscribe"] = `<${listUnsubURL}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  if (PROVIDER === "smtp") {
    const t = getTransport();
    const info = await t.sendMail({ from: FROM, to, subject, html, text, headers });
    return { ok: true, id: info.messageId };
  } else {
    getTransport(); // ensures SendGrid key is sanitized & set
    const msg = {
      from: FROM,
      to,
      subject,
      html,
      text,
      headers,
      mailSettings: { bypassListManagement: { enable: transactional } },
      categories: category ? [category] : undefined,
    };
    const [res] = await sg.send(msg);
    return { ok: res.statusCode < 300, id: res.headers["x-message-id"] || "" };
  }
}

module.exports = { sendMail, __diag: {
  provider: () => PROVIDER,
  isProd: () => isProd,
  from: () => FROM,
  keyLen: () => ((process.env.SENDGRID_API_KEY || "").length),
  keyPreview: () => ((process.env.SENDGRID_API_KEY || "").slice(0,5) + "..."),
}};