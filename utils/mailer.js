
// utils/mailer.js
const nodemailer = require("nodemailer");
const sg = require("@sendgrid/mail");

const ENV = process.env.ENV || "dev";
const FROM = process.env.MAIL_FROM || "Servezy <no-reply@example.com>";
const PROVIDER = (process.env.MAIL_PROVIDER || "sendgrid").toLowerCase();

const whitelist = (process.env.WHITELIST_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const canSend = (to) => {
  if (ENV === "prod") return true;
  return whitelist.includes(String(to).toLowerCase());
};

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
  // default: SendGrid
  sg.setApiKey(process.env.SENDGRID_API_KEY || "");
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
    const info = await t.sendMail({
      from: FROM,
      to,
      subject,
      html,
      text,
      headers,
    });
    return { ok: true, id: info.messageId };
  } else {
    const msg = {
      from: FROM,
      to,
      subject,
      html,
      text,
      headers,
      mailSettings: {
        bypassListManagement: { enable: transactional },
      },
      categories: category ? [category] : undefined,
    };
    const [res] = await sg.send(msg);
    return { ok: res.statusCode < 300, id: res.headers["x-message-id"] || "" };
  }
}

module.exports = { sendMail };